import json
import re
import shutil
import subprocess
from importlib.resources import files

import pytest

U = "00000000-0000-4000-8000-0000000000{:02d}".format
TREE = U(99)
PEOPLE = {
    U(1): {"name": "Ratilal", "sex": "male", "birth_date": "1915", "death_date": "1998"},
    U(2): {
        "name": "Divyaben",
        "sex": "female",
        "birth_date": "1945",
        "parents": [U(1)],
        "partners": [U(4)],
    },
    U(3): {"name": "Varshaben", "sex": "female", "birth_date": "1948", "parents": [U(1)]},
    U(4): {"name": "Shashank", "sex": "male", "birth_date": "1940", "partners": [U(2)]},
    U(5): {"name": "Ami", "sex": "female", "birth_date": "1970", "parents": [U(2), U(4)]},
    U(6): {"name": "Jai", "sex": "male", "parents": [U(5)], "private": True},
}
DATA = {
    "id": TREE,
    "name": "Amin Family",
    "site_name": "Our Family",
    "people": {i: {"id": i, **p} for i, p in PEOPLE.items()},
    "partnerships": {f"{U(2)}+{U(4)}": {"status": "married", "marriage_date": "1968"}},
}

# Runs the Pages Function with a fake KV store, published assets and a scripted Claude.
RUNNER = """
import { onRequestGet, onRequestPost } from "./ask.mjs";

const [steps, data] = JSON.parse(process.argv[2]);
const store = new Map();
const kv = {
  async get(key) { return store.get(key) ?? null; },
  async put(key, value) { store.set(key, value); },
};
const ASSETS = {
  async fetch(url) {
    const found = new URL(url).pathname === `/trees/${data.id}/data.json`;
    return new Response(found ? JSON.stringify(data) : "Not found", { status: found ? 200 : 404 });
  },
};

// Claude's side of the conversation: look both people up, ask how they connect, then answer.
const requests = [];
let mode = "answer";
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  requests.push({ url, headers: init.headers, body });
  const reply = (content, stop_reason = "end_turn") =>
    new Response(JSON.stringify({ content, stop_reason }), { status: 200 });
  if (mode === "busy") return new Response("overloaded", { status: 529 });
  if (mode === "refuse") return reply([], "refusal");
  const last = body.messages.at(-1);
  const results = Array.isArray(last.content) ? last.content.map((r) => r.content) : [];
  const thinking = { type: "thinking", thinking: "", signature: "sig" };
  if (!results.length) {
    return reply([thinking,
      { type: "tool_use", id: "t1", name: "find_people", input: { name: "jai" } },
      { type: "tool_use", id: "t2", name: "find_people", input: { name: "VARSHA" } },
    ], "tool_use");
  }
  if (results.length === 2 && last.content[0].tool_use_id === "t1") {
    const [jai, varsha] = results.map((r) => r.match(/^P\\d+/)[0]);
    return reply([
      { type: "tool_use", id: "t3", name: "connection", input: { from: jai, to: varsha } },
      { type: "tool_use", id: "t4", name: "relatives", input: { person: varsha } },
      { type: "tool_use", id: "t5", name: "relatives", input: { person: "P404" } },
    ], "tool_use");
  }
  const chain = results[0].split("\\n")[0];
  return reply([thinking, { type: "text", text: `${chain}. Also [Ghost](P404).` }]);
};

const results = [];
for (const [method, input = null, env = {}, setup = {}] of steps) {
  if (setup.mode) mode = setup.mode;
  const day = `ask:${new Date().toISOString().slice(0, 10)}`;
  if (setup.count !== undefined) store.set(day, String(setup.count));
  const body = typeof input === "string" ? input : JSON.stringify(input);
  const request = new Request("https://family.pages.dev/api/ask", {
    method, ...(input === null ? {} : { body }),
  });
  const handler = method === "GET" ? onRequestGet : onRequestPost;
  const keyed = { ASSETS, PHOTOS: kv, ANTHROPIC_API_KEY: "test-key", ...env };
  const response = await handler({ request, env: keyed });
  results.push([response.status, await response.json()]);
  requests.push("--");
}
console.log(JSON.stringify({ results, requests, count: [...store.values()] }));
"""


def run(steps, tmp_path):
    source = files("family_tree_mcp").joinpath("ask.js").read_text(encoding="utf-8")
    (tmp_path / "ask.mjs").write_text(source)
    (tmp_path / "run.mjs").write_text(RUNNER)
    result = subprocess.run(
        ["node", "run.mjs", json.dumps([steps, DATA])],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def question(text, *before):
    return {"tree": TREE, "messages": [*before, {"role": "user", "content": text}]}


@pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")
def test_ask_answers_with_a_chain_of_names_and_person_links(tmp_path) -> None:
    earlier = [
        {"role": "user", "content": "Who is Ami?"},
        {"role": "assistant", "content": f"[Ami](#{U(5)}) is Divyaben's daughter."},
    ]
    out = run([["POST", question("How is Jai related to Varshaben?", *earlier)]], tmp_path)
    [(status, body)] = out["results"]
    calls = [r for r in out["requests"] if r != "--"]
    assert status == 200 and len(calls) == 3 and out["count"] == ["1"]

    # The answer links people by UUID, and drops links to refs that don't exist.
    assert body["answer"] == (
        f"[Jai](#{U(6)}) → [Ami](#{U(5)}) (mom) → [Divyaben](#{U(2)}) (her mom) → "
        f"[Varshaben](#{U(3)}) (her sister). Also Ghost."
    )

    first = calls[0]
    assert first["url"] == "https://api.anthropic.com/v1/messages"
    assert first["headers"]["anthropic-version"] == "2026-10-21"
    assert first["headers"]["x-api-key"] == "test-key"
    request = first["body"]
    assert request["model"] == "claude-haiku-5-5" and request["output_config"] == {"effort": "low"}
    assert not {"temperature", "top_p", "top_k", "thinking"} & request.keys()
    assert [t["name"] for t in request["tools"]] == ["find_people", "relatives", "connection"]
    rules, tree = request["system"]
    assert "cousin" in rules["text"] and "cache_control" not in rules
    assert tree["cache_control"] == {"type": "ephemeral"}
    assert "Divyaben | female | born 1945 | parents: " in tree["text"]
    assert "partners: P" in tree["text"] and "(married 1968)" in tree["text"]
    assert "Jai | male | parents: " in tree["text"]
    assert "details hidden (may be living)" in tree["text"] and U(6) not in tree["text"]
    # Earlier answers go back to Claude with refs again, not UUIDs.
    ami = re.search(r"(P\d+) Ami \| ", tree["text"])
    assert ami is not None
    ami = ami.group(1)
    assert request["messages"][1]["content"] == f"[Ami]({ami}) is Divyaben's daughter."

    # Claude's turns, thinking included, go back unchanged with every tool's result.
    final = calls[2]["body"]["messages"]
    assert final[-2]["content"][0]["type"] == "tool_use"
    assert calls[1]["body"]["messages"][-2]["content"][0]["type"] == "thinking"
    connection, relatives, missing = (r["content"] for r in final[-1]["content"])
    assert connection.endswith(
        "Ami is Jai's mom; Divyaben is Ami's mom; Varshaben is Divyaben's sister."
    )
    assert "Parents: P1 Ratilal (1915–1998)" in relatives
    assert "Siblings: P" in relatives and "Divyaben (b. 1945)" in relatives
    assert "Grandchildren: none recorded" in relatives
    assert final[-1]["content"][2]["is_error"] is True and "find_people" in missing


@pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")
def test_ask_refuses_bad_requests_and_stays_within_the_daily_cap(tmp_path) -> None:
    too_long = "x" * 501
    steps = [
        ["GET"],
        ["GET", None, {"ANTHROPIC_API_KEY": ""}],
        ["POST", question("Hi"), {"ANTHROPIC_API_KEY": ""}],
        ["POST", "not json"],
        ["POST", {"tree": "../../secrets", "messages": [{"role": "user", "content": "Hi"}]}],
        ["POST", question(too_long)],
        ["POST", question("   ")],
        ["POST", {"tree": TREE, "messages": [{"role": "assistant", "content": "Hi"}]}],
        ["POST", {**question("Hi"), "tree": U(98)}],
        ["POST", question("Hi"), {}, {"count": 200}],
        ["POST", question("Hi"), {"ASK_DAILY_LIMIT": "500"}, {"mode": "refuse"}],
        ["POST", question("Hi"), {}, {"mode": "busy", "count": 0}],
    ]
    out = run(steps, tmp_path)
    assert [s for s, _ in out["results"]] == [
        *[200, 200, 503],  # enabled; not set up without a key
        *[400, 400, 400, 400, 400, 404],  # bad JSON, tree id, length, blank, order; unknown tree
        429,  # the day's questions are used up
        *[200, 502],  # Claude declines politely; an overloaded API asks to retry
    ]
    bodies = [b for _, b in out["results"]]
    assert bodies[0] == {"enabled": True} and bodies[1] == {"enabled": False}
    assert "tomorrow" in bodies[9]["error"]
    assert bodies[10]["answer"].startswith("Sorry, I can't help with that.")
    assert bodies[11]["error"] == "Ask is busy right now. Try again in a minute."
    # Only questions that reach Claude count; the cap message itself doesn't.
    assert out["count"] == ["1"]
