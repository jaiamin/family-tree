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
    assert set(pages) == {"index.html", "favicon.svg"}
    assert "No family trees yet" in pages["index.html"]
    assert '<script>alert("x")</script>' not in pages["index.html"]
    store = Store(tmp_path)
    first = store.create("First & family", '<img src=x onerror="alert(1)">')
    pages, _ = website_files(store.collection(), site)
    assert len(pages) == 4
    assert f'href="/trees/{first.id}/"' in pages["index.html"]
    assert "First &amp; family" in pages["index.html"]
    assert "<img src=x" not in pages["index.html"]
    assert "location.href" not in pages["index.html"]  # one tree still needs explicit choice
    second = store.create("Second")
    pages, _ = website_files(store.collection(), site)
    assert set(pages) == {
        "favicon.svg",
        "index.html",
        f"trees/{first.id}/index.html",
        f"trees/{first.id}/data.json",
        f"trees/{second.id}/index.html",
        f"trees/{second.id}/data.json",
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
    assert a["people"][shared.id]["other_trees"] == [{"id": second.id, "name": "Second"}]
    assert b["people"][shared.id]["other_trees"] == [{"id": first.id, "name": "First"}]
    assert "other_trees" not in a["people"][relative.id]
    assert set(b["people"]) == {shared.id}
    assert b["people"][shared.id]["parents"] == b["people"][shared.id]["partners"] == []
    assert b["partnerships"] == {}
    assert a["people"][shared.id]["parents"] == [relative.id]
    assert "birth_date" not in b["people"][shared.id]
    assert a["site_name"] == b["site_name"] == "Website"
    assert a["photos"] is True and hidden == 2
    # Ask reads the same data the page shows, so it never sees hidden details either.
    assert json.loads(pages[f"trees/{first.id}/data.json"]) == a
    assert "Shared" not in pages["index.html"]
    assert all("never-public" not in page and "Secret" not in page for page in pages.values())
    assert 'aria-label="Switch family tree"' in pages[f"trees/{first.id}/index.html"]
    assert "<option" not in pages[f"trees/{first.id}/index.html"]
    assert f'href="/trees/{second.id}/"' in pages[f"trees/{first.id}/index.html"]
    assert "<h2>Family trees (2)</h2>" in pages["index.html"]
    assert 'id="count"' not in pages["index.html"]
    assert "Family links" not in pages["index.html"]
    store.rename(first.id, "Renamed")
    renamed, _ = website_files(store.collection(), site)
    assert set(pages) == set(renamed)
    assert embedded(renamed[f"trees/{first.id}/index.html"])["name"] == "Renamed"
    assert store.collection().people[shared.id].notes == "Secret"
    assert embedded(renamed[f"trees/{second.id}/index.html"])["people"][shared.id][
        "other_trees"
    ] == [{"id": first.id, "name": "Renamed"}]
    store.membership(second.id, [shared.id], remove=True)
    removed, _ = website_files(store.collection(), site)
    assert (
        "other_trees" not in embedded(removed[f"trees/{first.id}/index.html"])["people"][shared.id]
    )


def test_template_tokens_in_user_names_remain_literal(tmp_path) -> None:
    store = Store(tmp_path)
    tree = store.create("__DATA__ __TITLE__ __TREES__")
    pages, _ = website_files(store.collection(), Site(name="__TREES__", project="example", url=""))
    assert "<title>__TREES__</title>" in pages["index.html"]
    assert "<title>__DATA__ __TITLE__ __TREES__</title>" in pages[f"trees/{tree.id}/index.html"]
    assert embedded(pages[f"trees/{tree.id}/index.html"])["name"] == tree.name


def test_home_and_tree_share_a_valid_svg_favicon(tmp_path) -> None:
    import xml.etree.ElementTree as ET

    store = Store(tmp_path)
    store.create("Family")
    pages, _ = website_files(store.collection(), Site(name="Website", project="example", url=""))
    icon = ET.fromstring(pages["favicon.svg"])
    assert icon.tag == "{http://www.w3.org/2000/svg}svg"
    for path, page in pages.items():
        if path.endswith(".html"):
            assert '<link rel="icon" type="image/svg+xml" href="/favicon.svg">' in page


def test_share_tree_action_is_only_on_tree_pages(tmp_path) -> None:
    store = Store(tmp_path)
    family = store.create("Family")
    pages, _ = website_files(store.collection(), Site(name="Website", project="example", url=""))
    assert 'id="share-tree"' not in pages["index.html"]
    page = pages[f"trees/{family.id}/index.html"]
    assert 'id="share-tree" aria-label="Share tree"' in page
    assert 'id="share-status" role="status"' in page
    assert "Share person" in page
