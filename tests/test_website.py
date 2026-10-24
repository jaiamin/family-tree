import json
import re

from family_tree_mcp.share import website_files
from family_tree_mcp.store import Collection, Store
from family_tree_mcp.tree import Site


def embedded(page: str) -> dict:
    match = re.search(r'<script id="tree-data" type="application/json">(.*?)</script>', page, re.S)
    assert match is not None
    return json.loads(match.group(1))


def test_chooser_for_zero_one_and_many_trees_with_safe_names(tmp_path) -> None:
    site = Site(name='Website <script>alert("x")</script>', project="example", url="")
    pages, _ = website_files(Collection(), site)
    assert list(pages) == ["index.html"]
    assert "No family trees yet" in pages["index.html"]
    assert '<script>alert("x")</script>' not in pages["index.html"]
    store = Store(tmp_path)
    first = store.create("First & family", '<img src=x onerror="alert(1)">')
    pages, _ = website_files(store.collection(), site)
    assert len(pages) == 2
    assert f'href="/trees/{first.id}/"' in pages["index.html"]
    assert "First &amp; family" in pages["index.html"]
    assert "<img src=x" not in pages["index.html"]
    assert "location.href" not in pages["index.html"]  # one tree still needs explicit choice
    second = store.create("Second")
    pages, _ = website_files(store.collection(), site)
    assert set(pages) == {
        "index.html",
        f"trees/{first.id}/index.html",
        f"trees/{second.id}/index.html",
    }


def test_pages_contain_only_members_and_links_while_sharing_uuid(tmp_path) -> None:
    store = Store(tmp_path)
    first, second = store.create("First"), store.create("Second")
    with store.edit(first.id) as tree:
        shared = tree.add_person("Shared", birth_date="2000", notes="Secret")
        relative = tree.add_person("First relative")
        tree.link(shared.id, "parent", relative.id)
        tree.link(shared.id, "partner", relative.id, marriage_date="2020")
    store.membership(second.id, [shared.id])
    site = Site(
        name="Website", project="example", url="", photos="namespace", edit_code="never-public"
    )
    pages, hidden = website_files(store.collection(), site)
    a = embedded(pages[f"trees/{first.id}/index.html"])
    b = embedded(pages[f"trees/{second.id}/index.html"])
    assert set(b["people"]) == {shared.id}
    assert b["people"][shared.id]["parents"] == b["people"][shared.id]["partners"] == []
    assert b["partnerships"] == {}
    assert a["people"][shared.id]["parents"] == [relative.id]
    assert "birth_date" not in b["people"][shared.id]
    assert a["site_name"] == b["site_name"] == "Website"
    assert a["photos"] is True and hidden == 2
    assert "Shared" not in pages["index.html"]
    assert all("never-public" not in page and "Secret" not in page for page in pages.values())
    assert 'aria-label="Switch family tree"' in pages[f"trees/{first.id}/index.html"]
    assert "<option" not in pages[f"trees/{first.id}/index.html"]
    assert f'href="/trees/{second.id}/"' in pages[f"trees/{first.id}/index.html"]
    assert '<h2>Family trees (2)</h2>' in pages["index.html"]
    assert 'id="count"' not in pages["index.html"]
    assert "Family links" not in pages["index.html"]
    store.rename(first.id, "Renamed")
    renamed, _ = website_files(store.collection(), site)
    assert set(pages) == set(renamed)
    assert embedded(renamed[f"trees/{first.id}/index.html"])["name"] == "Renamed"
    assert store.collection().people[shared.id].notes == "Secret"


def test_template_tokens_in_user_names_remain_literal(tmp_path) -> None:
    store = Store(tmp_path)
    tree = store.create("__DATA__ __TITLE__ __TREES__")
    pages, _ = website_files(store.collection(), Site(name="__TREES__", project="example", url=""))
    assert "<title>__TREES__</title>" in pages["index.html"]
    assert "<title>__DATA__ __TITLE__ __TREES__</title>" in pages[f"trees/{tree.id}/index.html"]
    assert embedded(pages[f"trees/{tree.id}/index.html"])["name"] == tree.name
