"""Exercise the real HTTP adapter, including failure and concurrent save behavior."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, TypedDict
from uuid import uuid4

import pytest
from family_tree_mcp.store import Collection, Store


class State(TypedDict):
    collection: dict[str, Any]
    revision: int
    writes: int


@pytest.fixture
def remote():
    state: State = {"collection": Collection().model_dump(mode="json"), "revision": 0, "writes": 0}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args):
            pass

        def reply(self, status, body):
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())

        def authorized(self):
            if self.headers.get("Authorization") != "Bearer test-owner-token":
                self.reply(401, {"error": "Please sign in."})
                return False
            return True

        def do_GET(self):
            if self.authorized():
                self.reply(200, state)

        def do_PUT(self):
            if not self.authorized():
                return
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if body["revision"] != state["revision"]:
                self.reply(409, {"error": "Someone else updated the tree. Reload before saving."})
                return
            state.update(collection=body["collection"], revision=state["revision"] + 1)
            state["writes"] += 1
            self.reply(200, {"revision": state["revision"]})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield Store(f"http://127.0.0.1:{server.server_port}/family-tree", "test-owner-token"), state
    finally:
        server.shutdown()
        server.server_close()
        worker.join()


def test_http_edits_and_conflicts_do_not_retry_stale_writes(remote):
    store, state = remote
    tree = store.create("Family")
    assert store.load(tree.id).name == "Family"
    writes = state["writes"]
    with pytest.raises(ValueError, match="Someone else"), store.transaction() as collection:
        collection.trees[tree.id].name = "Stale edit"
        state["collection"]["trees"][tree.id]["name"] = "Another editor"
        state["revision"] += 1
    assert state["writes"] == writes
    assert store.load(tree.id).name == "Another editor"


def test_import_preserves_ids_strips_legacy_site_secrets_and_refuses_overwrite(remote, tmp_path):
    store, state = remote
    person_id, tree_id = str(uuid4()), str(uuid4())
    legacy = {
        "version": 1,
        "people": {person_id: {"id": person_id, "name": "Relative"}},
        "trees": {tree_id: {"id": tree_id, "name": "Family", "members": [person_id]}},
        "site": {
            "name": "Family",
            "url": "https://example.com",
            "edit_code": "obsolete-test-value",
        },
    }
    path = tmp_path / "collection.json"
    path.write_text(json.dumps(legacy))
    assert store.import_collection(str(path)) == {"people": 1, "trees": 1}
    assert store.collection().people[person_id].name == "Relative"
    assert state["collection"]["site"] == {"name": "Family", "url": "https://example.com"}
    with pytest.raises(ValueError, match="empty"):
        store.import_collection(str(path))


def test_http_authentication_error_is_actionable(remote):
    store, _ = remote
    unauthorized = Store(store.url, "invalid-test-token")
    with pytest.raises(ValueError, match="Please sign in"):
        unauthorized.collection()


@pytest.mark.parametrize(
    "url",
    ["http://example.com", "https://user:password@example.com", "https://example.com?token=x"],
)
def test_remote_store_rejects_insecure_or_credential_bearing_urls(url):
    with pytest.raises(ValueError):
        Store(url, "test-token")


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_redirects_never_forward_the_owner_token_to_another_origin(remote, status):
    destination, state = remote
    received = []

    class Redirect(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args):
            pass

        def do_GET(self):
            received.append(self.headers.get("Authorization"))
            self.send_response(status)
            self.send_header("Location", f"{destination.url}/api/collection")
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        source = Store(f"http://127.0.0.1:{server.server_port}/family-tree", "test-owner-token")
        # Python 3.10 refuses 308 redirects; newer versions follow without credentials.
        with pytest.raises(ValueError, match=r"^(Please sign in\.|Website request failed\.)$"):
            source.collection()
        assert received == ["Bearer test-owner-token"]
        assert state["writes"] == 0
    finally:
        server.shutdown()
        server.server_close()
        worker.join()
