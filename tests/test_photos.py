import hashlib
import json
import shutil
import subprocess
from importlib.resources import files

import pytest

# Runs the Pages Function against an in-memory Workers KV, one request per step.
RUNNER = """
import { onRequest } from "./photos.mjs";

const steps = JSON.parse(process.argv[2]);
const store = new Map();
const kv = {
  async get(key, type) {
    const item = store.get(key);
    return item ? (type === "json" ? JSON.parse(item.value) : item.value) : null;
  },
  async getWithMetadata(key) {
    const item = store.get(key);
    return { value: item?.value ?? null, metadata: item?.metadata ?? null };
  },
  async put(key, value, options = {}) { store.set(key, { value, metadata: options.metadata }); },
  async delete(key) { store.delete(key); },
};
const results = [];
for (const [method, path, headers = {}, size = 0, bound = true] of steps) {
  const body = size ? new Uint8Array(size).fill(7) : undefined;
  const url = `https://family.pages.dev/api/photos${path}`;
  const request = new Request(url, { method, headers, body });
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const env = { EDIT_CODE_HASH: process.argv[3], ...(bound ? { PHOTOS: kv } : {}) };
  const response = await onRequest({ request, env, params: parts.length ? { path: parts } : {} });
  const type = response.headers.get("content-type") || "";
  const text = type.startsWith("image/")
    ? `${(await response.arrayBuffer()).byteLength} bytes`
    : await response.text();
  results.push([response.status, type, response.headers.get("cache-control"), text]);
}
console.log(JSON.stringify(results));
"""


@pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")
def test_photo_function(tmp_path) -> None:
    source = files("family_tree_mcp").joinpath("photos.js").read_text(encoding="utf-8")
    (tmp_path / "photos.mjs").write_text(source)
    (tmp_path / "run.mjs").write_text(RUNNER)
    code = {"x-edit-code": " Amber-River-Oak-42 "}
    jpeg = {**code, "content-type": "image/jpeg"}
    steps = [
        ["GET", ""],
        ["POST", "", {}],
        ["POST", "", {"x-edit-code": "wrong-code"}],
        ["POST", "", code],
        ["PUT", "/ami", {"content-type": "image/jpeg"}, 10],
        ["PUT", "/ami", {**code, "content-type": "image/gif"}, 10],
        ["PUT", "/ami", jpeg, 600 * 1024],
        ["PUT", "/Bad_Id", jpeg, 10],
        ["PUT", "/ami/extra", jpeg, 10],
        ["PUT", "", jpeg, 10],
        ["PUT", "/ami", jpeg, 2048],
        ["GET", ""],
        ["GET", "/ami?v=1"],
        ["GET", "/ami"],
        ["DELETE", "/ami", {}],
        ["DELETE", "/ami", code],
        ["GET", ""],
        ["GET", "/ami"],
        ["GET", "", {}, 0, False],
    ]
    digest = hashlib.sha256(b"amber-river-oak-42").hexdigest()
    result = subprocess.run(
        ["node", "run.mjs", json.dumps(steps), digest],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    got = json.loads(result.stdout)
    status = [r[0] for r in got]
    assert status == [
        *[200, 403, 403, 204],  # list; check the code: missing, wrong, right (any case/spaces)
        *[403, 415, 413, 404, 404, 405],  # uploads refused: no code, type, size, ids, no id
        *[200, 200, 200, 200],  # upload, then list and fetch it
        *[403, 200, 200, 404],  # remove needs the code; then it's gone
        503,  # the site has no photo store
    ]
    assert got[0][3] == "{}" and json.loads(got[1][3]) == {"error": "That family code isn't right."}
    version = json.loads(got[10][3])["v"]
    assert json.loads(got[11][3]) == {"ami": version}
    assert got[12][:2] == [200, "image/jpeg"] and got[12][3] == "2048 bytes"
    assert got[12][2] == "public, max-age=31536000, immutable" and got[13][2] == "no-cache"
    assert got[16][3] == "{}"
