"""Publish share pages to Cloudflare Pages with wrangler and keep them updated."""

import os
import re
import shutil
import subprocess
import sys
import threading
from collections.abc import Callable
from pathlib import Path

from family_tree_mcp.tree import Tree

WRANGLER = ["--yes", "wrangler@4"]
# Desktop apps often start servers without the shell's PATH, so look where Node usually lives.
NODE_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", str(Path.home() / ".volta/bin")]


def deploy(folder: Path, project: str, create: bool = True) -> str:
    """Deploy the folder to the Pages project, creating it first if asked; return its URL."""
    if create:
        created = _wrangler("pages", "project", "create", project, "--production-branch", "main")
        if created.returncode and "already exists" not in created.stdout:
            raise ValueError(_failure(created.stdout))
    deployed = _wrangler(
        "pages", "deploy", str(folder), "--project-name", project, "--branch", "main",
        "--commit-dirty=true",
    )  # fmt: skip
    if deployed.returncode:
        raise ValueError(_failure(deployed.stdout))
    # Deployments get a unique host like https://1a2b3c.<project>.pages.dev; the site is the rest.
    if match := re.search(r"https://[a-z0-9-]+\.([a-z0-9-]+\.pages\.dev)", deployed.stdout):
        return f"https://{match.group(1)}"
    return f"https://{project}.pages.dev"


def _wrangler(*args: str) -> subprocess.CompletedProcess[str]:
    path = os.pathsep.join([os.environ.get("PATH", ""), *NODE_DIRS])
    if not (npx := shutil.which("npx", path=path)):
        raise ValueError("Publishing needs Node.js (for npx). Install it from https://nodejs.org.")
    env = {**os.environ, "PATH": os.pathsep.join([str(Path(npx).parent), path])}
    try:
        return subprocess.run(
            [npx, *WRANGLER, *args],
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
    lines = [line for line in output.strip().splitlines() if line.strip()]
    return "Publishing failed: " + " ".join(lines[-3:])


class Updater:
    """Run publish jobs one at a time on a background thread, collapsing repeated requests."""

    def __init__(self, publish: Callable[[str], None]) -> None:
        self._publish = publish
        self._pending: list[str] = []
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self.errors: dict[str, str] = {}

    def schedule(self, tree: Tree) -> None:
        if not (tree.site and tree.site.keep_updated):
            return
        with self._lock:
            if tree.name not in self._pending:
                self._pending.append(tree.name)
            if not (self._thread and self._thread.is_alive()):
                self._thread = threading.Thread(target=self._run, daemon=True)
                self._thread.start()

    def wait(self) -> None:
        if self._thread:
            self._thread.join()

    def _run(self) -> None:
        while True:
            with self._lock:
                if not self._pending:
                    return
                name = self._pending.pop(0)
            try:
                self._publish(name)
                self.errors.pop(name, None)
            except Exception as error:
                self.errors[name] = str(error)
                print(f"family-tree-mcp: updating '{name}' failed: {error}", file=sys.stderr)
