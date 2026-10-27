from uuid import UUID

import pytest
from conftest import MemoryStore as Store
from family_tree_mcp import create_server
from fastmcp import Client
from fastmcp.exceptions import ToolError


async def test_build_share_query_and_reopen(tmp_path) -> None:
    store = Store(tmp_path)
    async with Client(create_server(store)) as client:
        first = await client.call_tool("create_tree", {"name": "The Smiths"})
        tid = first.data["id"]
        tree = {"tree": tid}
        family = await client.call_tool(
            "add_people",
            {
                **tree,
                "people": [
                    {"name": "Ada Smith", "sex": "female"},
                    {"name": "Ben Smith", "sex": "male", "parents": ["Ada Smith"]},
                    {"name": "Cy Smith", "sex": "male", "parents": ["Ada Smith"]},
                ],
            },
        )
        ids = family.data["ids"]
        assert all(UUID(pid).version == 4 for pid in ids.values())
        result = await client.call_tool(
            "get_relationship",
            {**tree, "person_id": ids["Ben Smith"], "relative_id": ids["Cy Smith"]},
        )
        assert result.data["summary"] == "Cy Smith is Ben Smith's brother."
        assert len((await client.call_tool("find_people", {})).data) == 3
        duplicate = await client.call_tool(
            "add_people",
            {
                **tree,
                "people": [{"name": "Ben Smith"}, {"name": "Dee Smith", "partners": ["Ben Smith"]}],
            },
        )
        dup = duplicate.data["ids"]["Ben Smith"]
        dee = duplicate.data["ids"]["Dee Smith"]
        assert duplicate.data["possible_duplicates"] == [
            {"new_id": dup, "existing_id": ids["Ben Smith"]}
        ]
        second = await client.call_tool("create_tree", {"name": "Other"})
        await client.call_tool(
            "set_tree_members", {"tree": second.data["id"], "person_ids": [dup, dee]}
        )
        merged = await client.call_tool(
            "merge_people", {**tree, "keep_id": ids["Ben Smith"], "duplicate_id": dup}
        )
        assert merged.data["partners"] == [{"id": dee, "name": "Dee Smith"}]
        await client.call_tool("rename_tree", {**tree, "new_name": "Smith Family"})

    async with Client(create_server(store)) as client:
        trees = (await client.call_tool("list_trees", {})).data
        assert {t["name"]: t["people"] for t in trees} == {"Smith Family": 4, "Other": 2}
        people = await client.call_tool("find_people", {"query": "ben"})
        assert people.data == [{"id": ids["Ben Smith"], "name": "Ben Smith"}]
        await client.call_tool(
            "update_people",
            {"tree": second.data["id"], "changes": [{"id": ids["Ben Smith"], "name": "Benjamin"}]},
        )
        assert (await client.call_tool("get_person", {**tree, "person_id": ids["Ben Smith"]})).data[
            "name"
        ] == "Benjamin"


async def test_batch_is_atomic_and_flags_one_parent_children(tmp_path) -> None:
    async with Client(create_server(Store(tmp_path))) as client:
        await client.call_tool("create_tree", {"name": "Family"})
        tree = {"tree": "Family"}
        added = await client.call_tool(
            "add_people",
            {
                **tree,
                "people": [
                    {"name": "Father"},
                    {"name": "Child", "parents": ["Father"]},
                    {"name": "Mother"},
                ],
            },
        )
        dad, kid, mom = [added.data["ids"][n] for n in ("Father", "Child", "Mother")]
        married = await client.call_tool(
            "update_people",
            {**tree, "links": [{"person_id": dad, "relation": "partner", "relative_id": mom}]},
        )
        assert married.data["check"] == [
            "Child lists only Father as a parent. If Mother is the other parent, link them."
        ]
        bad = [
            {"person_id": kid, "relation": "parent", "relative_id": mom},
            {"person_id": dad, "relation": "parent", "relative_id": "nobody"},
        ]
        with pytest.raises(ToolError, match="nobody"):
            await client.call_tool("update_people", {**tree, "links": bad})
        assert (
            len((await client.call_tool("get_person", {**tree, "person_id": kid})).data["parents"])
            == 1
        )
        result = await client.call_tool(
            "update_people",
            {
                **tree,
                "changes": [
                    {"id": dad, "name": "Renamed father"},
                    {"id": kid, "birth_date": "1990"},
                ],
                "links": [{"person_id": kid, "relation": "parent", "relative_id": mom}],
            },
        )
        assert result.data == {"updated": 2, "links_added": 1, "links_removed": 0}
        assert (await client.call_tool("check_tree", tree)).data["summary"] == "All clear."
