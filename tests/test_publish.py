import asyncio
import os
import stat
import time

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from family_tree_mcp import create_server
from family_tree_mcp.publish import Updater
from family_tree_mcp.store import Store
from family_tree_mcp.tree import Site, Tree

# Stands in for `npx --yes wrangler@4 ...`, recording each call and answering like wrangler.
FAKE_NPX = """#!/bin/sh
shift 2
echo "$1 $2" >> "$CALLS"
case "$1 $2" in
  "pages project")
    [ -n "$CREATED" ] && { echo "A project with this name already exists"; exit 1; }
    echo "Successfully created the project." ;;
  "pages deploy")
    [ -n "$LOGGED_OUT" ] && { echo "You are not authenticated. Run wrangler login."; exit 1; }
    echo "Take a peek over at https://1a2b3c.smiths-x9.pages.dev" ;;
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
    return lambda: log.read_text().splitlines()


@pytest.mark.skipif(os.name == "nt", reason="fake npx is a shell script")
async def test_publish_once_then_keep_updated(tmp_path, calls, monkeypatch) -> None:
    store = Store(tmp_path / "trees")
    async with Client(create_server(store, publish_delay=0)) as client:
        await client.call_tool("create_tree", {"name": "Smiths"})
        tree = {"tree": "Smiths"}
        await client.call_tool("add_person", {**tree, "name": "Ann", "birth_date": "1990"})

        site = await client.call_tool("publish_site", tree)
        assert site.data["url"] == "https://smiths-x9.pages.dev"
        assert site.data["hidden_living"] == 1
        assert calls() == ["pages project", "pages deploy"]

        # Every change republishes in the background; a change the page doesn't show doesn't.
        monkeypatch.setenv("CREATED", "1")
        await client.call_tool("add_person", {**tree, "name": "Bo"})
        await asyncio.to_thread(_wait, store)
        page = (tmp_path / "trees/exports/smiths-site/index.html").read_text()
        assert '"Bo"' in page and calls()[2:] == ["pages deploy"]
        await client.call_tool("update_person", {**tree, "person_id": "ann", "notes": "private"})
        await asyncio.to_thread(_wait, store)
        assert len(calls()) == 3

        listed = await client.call_tool("list_trees", {})
        assert listed.data[0]["site"] == "https://smiths-x9.pages.dev"

        await client.call_tool("publish_site", {**tree, "keep_updated": False})
        count = len(calls())
        await client.call_tool("add_person", {**tree, "name": "Cy"})
        await asyncio.to_thread(_wait, store)
        assert len(calls()) == count

        monkeypatch.setenv("LOGGED_OUT", "1")
        with pytest.raises(ToolError, match="npx wrangler login"):
            await client.call_tool("publish_site", tree)


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
