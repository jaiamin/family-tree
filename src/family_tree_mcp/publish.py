"""Publish share pages to Cloudflare Pages with wrangler and keep them updated."""

import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from datetime import datetime
from importlib.resources import files
from pathlib import Path

from family_tree_mcp.store import Collection
from family_tree_mcp.tree import Site

WRANGLER = ["--yes", "wrangler@4"]
# Desktop apps often start servers without the shell's PATH, so look where Node usually lives.
NODE_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", str(Path.home() / ".volta/bin")]


# Family codes look like "amber-river-falcon-42": easy to say aloud, hard to guess.
_WORDS = """
amber apple aspen autumn basil birch bloom brook cedar cherry clover coral cotton daisy dawn
delta ember fern field flint forest frost garden ginger harbor hazel honey indigo iris island
ivory jade jasmine juniper kettle lagoon lantern lemon lilac linen lotus maple meadow mint moss
nectar oak ocean olive orchid pebble pepper pine plum poppy prairie quartz rain raven reed
river robin rose saffron sage sand shell silver sky snow spruce star stone summer sun thistle
thunder tide tulip valley velvet violet walnut willow winter wren
"""
WORDS = _WORDS.split()


def new_code() -> str:
    return "-".join([*(secrets.choice(WORDS) for _ in range(3)), str(10 + secrets.randbelow(90))])


def site_files(pages: dict[str, str], site: Site | None) -> dict[str, str]:
    """The files of the Pages project for a page: with photos, also their function and config."""
    found = {f"public/{path}": page for path, page in pages.items()}
    if site and site.photos and site.edit_code:
        code = hashlib.sha256(site.edit_code.encode()).hexdigest()
        function = files("family_tree_mcp").joinpath("photos.js").read_text(encoding="utf-8")
        found["functions/api/photos/[[path]].js"] = function
        found["wrangler.toml"] = (
            f'name = "{site.project}"\n'
            'pages_build_output_dir = "public"\n'
            'compatibility_date = "2025-01-01"\n\n'
            f'[vars]\nEDIT_CODE_HASH = "{code}"\n\n'
            f'[[kv_namespaces]]\nbinding = "PHOTOS"\nid = "{site.photos}"\n'
        )
    return found


def photo_store(folder: Path, project: str) -> str:
    """Return the id of the project's Workers KV namespace for photos, creating it if needed."""
    title = f"{project}-photos"
    if found := _namespace(folder, title):
        return found
    created = _wrangler(folder, "kv", "namespace", "create", title)
    if created.returncode and "already exists" not in created.stdout:
        raise ValueError(_failure(created.stdout))
    if found := _namespace(folder, title):
        return found
    raise ValueError("Publishing failed: Cloudflare didn't list the new photo store. Try again.")


def _namespace(folder: Path, title: str) -> str | None:
    listed = _wrangler(folder, "kv", "namespace", "list")
    # The JSON list follows any warnings wrangler prints, such as "[WARNING] ...".
    json_start = re.search(r"^\[\s*(?:\{|\]|$)", listed.stdout, re.MULTILINE)
    if listed.returncode or not (start := json_start):
        raise ValueError(_failure(listed.stdout))
    spaces, _ = json.JSONDecoder().raw_decode(listed.stdout[start.start() :])
    # Older wrangler versions prefix the title with the project name.
    for space in spaces:
        if space.get("title") == title or space.get("title", "").endswith(f"-{title}"):
            return space["id"]
    return None


def deploy(folder: Path, project: str, create: bool = True) -> str:
    """Deploy the site folder to the Pages project, creating it first if asked; return its URL."""
    if create:
        created = _wrangler(
            folder, "pages", "project", "create", project, "--production-branch", "main"
        )
        if created.returncode and "already exists" not in created.stdout:
            raise ValueError(_failure(created.stdout))
    deployed = _wrangler(
        folder, "pages", "deploy", "public", "--project-name", project, "--branch", "main",
        "--commit-dirty=true",
    )  # fmt: skip
    if deployed.returncode:
        raise ValueError(_failure(deployed.stdout))
    # Deployments get a unique host like https://1a2b3c.<project>.pages.dev; the site is the rest.
    if match := re.search(r"https://[a-z0-9-]+\.([a-z0-9-]+\.pages\.dev)", deployed.stdout):
        return f"https://{match.group(1)}"
    return f"https://{project}.pages.dev"


def _wrangler(folder: Path, *args: str) -> subprocess.CompletedProcess[str]:
    path = os.pathsep.join([os.environ.get("PATH", ""), *NODE_DIRS])
    if not (npx := shutil.which("npx", path=path)):
        raise ValueError("Publishing needs Node.js (for npx). Install it from https://nodejs.org.")
    env = {**os.environ, "PATH": os.pathsep.join([str(Path(npx).parent), path])}
    try:
        return subprocess.run(
            [npx, *WRANGLER, *args],
            # Wrangler reads functions/ and wrangler.toml from its working directory and writes
            # .wrangler/tmp there, and apps often start servers in a read-only one like /.
            cwd=folder,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=300,
        )
    except subprocess.TimeoutExpired:
        raise ValueError("Publishing timed out after 5 minutes. Try again.") from None


def _failure(output: str) -> str:
    if re.search(r"log ?in|authenticat|CLOUDFLARE_API_TOKEN", output, re.IGNORECASE):
        return "Run `npx wrangler login` once in a terminal to connect Cloudflare, then try again."
    lines = [line.strip() for line in re.sub(r"\x1b\[[0-9;]*m", "", output).splitlines()]
    lines = [line for line in lines if line and not line.startswith("🪵")]
    start = next((i for i, line in enumerate(lines) if "ERROR" in line), max(len(lines) - 3, 0))
    return "Publishing failed: " + " ".join(lines[start : start + 2])


class Updater:
    """Publish a tree once its edits pause for `delay` seconds, one job at a time."""

    def __init__(self, publish: Callable[[str], None], delay: float = 30) -> None:
        self._publish = publish
        self._delay = delay
        self._due: dict[str, float] = {}
        self._wake = threading.Condition()
        self._thread: threading.Thread | None = None
        self._publishing: str | None = None
        self.errors: dict[str, str] = {}
        self.published: dict[str, datetime] = {}  # last successful update in this session

    def status(self, name: str) -> dict[str, str]:
        """Where a tree's automatic updates stand, for list_trees."""
        with self._wake:
            if name == self._publishing:
                state = {"site_status": "publishing"}
            elif name in self._due:
                state = {"site_status": "waiting for edits to pause"}
            elif name in self.errors:
                state = {"site_status": "failed"}
            elif name in self.published:
                state = {"site_status": "published"}
            else:
                state = {"site_status": "no changes since the server started"}
            if error := self.errors.get(name):
                state["site_error"] = error
            if when := self.published.get(name):
                state["published_at"] = when.isoformat(timespec="seconds")
            return state

    def schedule(self, collection: Collection) -> None:
        if not (collection.site and collection.site.url and collection.site.keep_updated):
            return
        with self._wake:
            self._due["site"] = time.monotonic() + self._delay
            if not (self._thread and self._thread.is_alive()):
                self._thread = threading.Thread(target=self._run, daemon=True)
                self._thread.start()
            self._wake.notify()

    def flush(self) -> None:
        """Publish pending changes now and wait for them, e.g. before the server exits."""
        with self._wake:
            self._due = dict.fromkeys(self._due, 0.0)
            self._wake.notify()
        if self._thread:
            self._thread.join()

    def _run(self) -> None:
        while True:
            with self._wake:
                if not self._due:
                    return
                name, due = min(self._due.items(), key=lambda item: item[1])
                if (left := due - time.monotonic()) > 0:
                    self._wake.wait(left)
                    continue
                del self._due[name]
                self._publishing = name
            try:
                self._publish(name)
                self.errors.pop(name, None)
                self.published[name] = datetime.now().astimezone()
            except Exception as error:
                self.errors[name] = str(error)
                print(f"family-tree-mcp: updating '{name}' failed: {error}", file=sys.stderr)
            finally:
                with self._wake:
                    self._publishing = None
