import asyncio
import hashlib
import os
import re
import stat
import time

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from family_tree_mcp import create_server
from family_tree_mcp.publish import Updater, _failure
from family_tree_mcp.store import Store
from family_tree_mcp.tree import Site, Tree

# Stands in for `npx --yes wrangler@4 ...`, recording each call and answering like wrangler.
FAKE_NPX = """#!/bin/sh
shift 2
echo "$1 $2 $3" >> "$CALLS"
mkdir -p .wrangler/tmp || exit 1
case "$1 $2 $3" in
  "pages project create")
    [ -n "$CREATED" ] && { echo "A project with this name already exists"; exit 1; }
    echo "Successfully created the project." ;;
  "pages deploy public")
    [ -n "$LOGGED_OUT" ] && { echo "You are not authenticated. Run wrangler login."; exit 1; }
    [ -f public/index.html ] || { echo "[ERROR] No public/index.html"; exit 1; }
    if [ -f "$KV" ]; then
      [ -f wrangler.toml ] && [ -f "functions/api/photos/[[path]].js" ] \
        || { echo "[ERROR] Missing photo files"; exit 1; }
    fi
    echo "Take a peek over at https://1a2b3c.smiths-x9.pages.dev" ;;
  "kv namespace list")
    echo "[WARNING] Proxy environment variables detected."
    if [ -f "$KV" ]; then
      printf '[\n  {"id": "other", "title": "elsewhere"},\n  {"id": "kv123", "title": "%s"}\n]\n' \
        "$(cat "$KV")"
    else
      echo "[]"
    fi ;;
  "kv namespace create")
    echo "$4" > "$KV"
    echo "Success!" ;;
esac
"""


@pytest.fixture
def calls(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    npx = bin_dir / "npx"
    npx.write_text(FAKE_NPX)
    npx.chmod(npx.stat().st_mode | stat.S_IEXEC)
    log = tmp_path / "calls.log"
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("CALLS", str(log))
    monkeypatch.setenv("KV", str(tmp_path / "kv"))
    return lambda: log.read_text().splitlines()


@pytest.mark.skipif(os.name == "nt", reason="fake npx is a shell script")
async def test_publish_once_then_keep_updated(tmp_path, calls, monkeypatch) -> None:
    # Apps like Claude Desktop start servers in a read-only directory such as /.
    read_only = tmp_path / "read-only"
    read_only.mkdir(mode=0o555)
    monkeypatch.chdir(read_only)
    store = Store(tmp_path / "trees")
    async with Client(create_server(store, publish_delay=0)) as client:
        await client.call_tool("create_tree", {"name": "Smiths"})
        tree = {"tree": "Smiths"}
        await client.call_tool("add_person", {**tree, "name": "Ann", "birth_date": "1990"})

        site = await client.call_tool("publish_site", tree)
        assert site.data["url"] == "https://smiths-x9.pages.dev"
        assert site.data["hidden_living"] == 1
        assert calls() == [
            "kv namespace list",
            "kv namespace create",
            "kv namespace list",
            "pages project create",
            "pages deploy public",
        ]
        # The page has photos; Cloudflare gets the code's hash and the photo store, not the code.
        code = site.data["photo_code"]
        assert re.fullmatch(r"[a-z]+-[a-z]+-[a-z]+-\d\d", code)
        folder = tmp_path / "trees/exports/smiths-site"
        config = (folder / "wrangler.toml").read_text()
        assert 'id = "kv123"' in config and hashlib.sha256(code.encode()).hexdigest() in config
        page = (folder / "public/index.html").read_text()
        assert code not in config and code not in page and '"photos": true' in page

        # Every change republishes in the background; a change the page doesn't show doesn't.
        monkeypatch.setenv("CREATED", "1")
        await client.call_tool("add_person", {**tree, "name": "Bo"})
        await asyncio.to_thread(_wait, store)
        page = (folder / "public/index.html").read_text()
        assert '"Bo"' in page and calls()[5:] == ["pages deploy public"]
        await client.call_tool("update_person", {**tree, "person_id": "ann", "notes": "private"})
        await asyncio.to_thread(_wait, store)
        assert len(calls()) == 6

        listed = await client.call_tool("list_trees", {})
        assert listed.data[0]["site"] == "https://smiths-x9.pages.dev"

        # Republishing keeps the photo store and the code.
        again = await client.call_tool("publish_site", {**tree, "keep_updated": False})
        assert again.data["photo_code"] == code
        assert calls()[6:] == ["pages project create", "pages deploy public"]
        count = len(calls())
        await client.call_tool("add_person", {**tree, "name": "Cy"})
        await asyncio.to_thread(_wait, store)
        assert len(calls()) == count

        changed = await client.call_tool("change_photo_code", {**tree, "code": " Our-Family-1950 "})
        assert changed.data["photo_code"] == "our-family-1950"
        config = (folder / "wrangler.toml").read_text()
        assert hashlib.sha256(b"our-family-1950").hexdigest() in config
        assert calls()[count:] == ["pages deploy public"]
        with pytest.raises(ToolError, match="at least 6"):
            await client.call_tool("change_photo_code", {**tree, "code": "abc"})

        monkeypatch.setenv("LOGGED_OUT", "1")
        with pytest.raises(ToolError, match="npx wrangler login"):
            await client.call_tool("publish_site", tree)


@pytest.mark.skipif(os.name == "nt", reason="fake npx is a shell script")
async def test_sites_published_before_photos_keep_updating_without_them(tmp_path, calls) -> None:
    store = Store(tmp_path / "trees")
    store.create("Smiths")
    with store.edit("Smiths") as t:
        t.site = Site(project="smiths", url="https://smiths.pages.dev")
    async with Client(create_server(store, publish_delay=0)) as client:
        await client.call_tool("add_person", {"tree": "Smiths", "name": "Ann"})
        await asyncio.to_thread(_wait, store)
        with pytest.raises(ToolError, match="publish_site first"):
            await client.call_tool("change_photo_code", {"tree": "Smiths"})
    folder = tmp_path / "trees/exports/smiths-site"
    assert calls() == ["pages deploy public"]
    assert '"photos"' not in (folder / "public/index.html").read_text()
    assert not (folder / "wrangler.toml").exists()


async def test_parallel_tool_calls_keep_every_change(tmp_path) -> None:
    async with Client(create_server(Store(tmp_path))) as client:
        await client.call_tool("create_tree", {"name": "T"})
        await asyncio.gather(
            *[client.call_tool("add_person", {"tree": "T", "name": f"P{i}"}) for i in range(15)]
        )
        people = await client.call_tool("find_people", {"tree": "T"})
        assert len(people.data) == 15


def _wait(store: Store) -> None:
    store.on_change.__self__.flush()  # ty: ignore[unresolved-attribute]  # the server's Updater


def test_updates_wait_for_edits_to_pause() -> None:
    published = []
    updater = Updater(published.append, delay=0.2)
    tree = Tree(name="T", site=Site(project="t", url="https://t.pages.dev"))
    for _ in range(5):
        updater.schedule(tree)
        time.sleep(0.05)
    assert published == []
    time.sleep(0.4)
    assert published == ["T"]
    updater.schedule(tree)
    updater.flush()
    assert published == ["T", "T"]


def test_failures_keep_wranglers_error_and_path() -> None:
    output = """\x1b[31m✘ [ERROR] A file or directory could not be found.\x1b[0m

  Missing file or directory: /.wrangler/tmp
  This is typically caused by:
🪵  Logs were written to "/Users/me/Library/Preferences/.wrangler/logs/x.log"
"""
    assert _failure(output) == (
        "Publishing failed: ✘ [ERROR] A file or directory could not be found. "
        "Missing file or directory: /.wrangler/tmp"
    )
