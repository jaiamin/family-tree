"""Publish share pages to Cloudflare Pages with wrangler and keep them updated."""

import os
import re
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path

from family_tree_mcp.tree import Tree

WRANGLER = ["--yes", "wrangler@4"]
# Desktop apps often start servers without the shell's PATH, so look where Node usually lives.
NODE_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", str(Path.home() / ".volta/bin")]


def deploy(folder: Path, project: str, create: bool = True) -> str:
    """Deploy the folder to the Pages project, creating it first if asked; return its URL."""
    if create:
        created = _wrangler(
            folder, "pages", "project", "create", project, "--production-branch", "main"
        )
        if created.returncode and "already exists" not in created.stdout:
            raise ValueError(_failure(created.stdout))
    deployed = _wrangler(
        folder, "pages", "deploy", str(folder), "--project-name", project, "--branch", "main",
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
            # Wrangler writes .wrangler/tmp in its working directory, and apps often start
            # servers in a read-only one like /.
            cwd=folder.parent,
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
        self.errors: dict[str, str] = {}

    def schedule(self, tree: Tree) -> None:
        if not (tree.site and tree.site.keep_updated):
            return
        with self._wake:
            self._due[tree.name] = time.monotonic() + self._delay
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
            try:
                self._publish(name)
                self.errors.pop(name, None)
            except Exception as error:
                self.errors[name] = str(error)
                print(f"family-tree-mcp: updating '{name}' failed: {error}", file=sys.stderr)
