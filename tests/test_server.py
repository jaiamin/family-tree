from pathlib import Path

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from family_tree_mcp import create_server
from family_tree_mcp.store import Store


async def test_build_and_query_tree(tmp_path) -> None:
    async with Client(create_server(Store(tmp_path))) as client:
        await client.call_tool("create_tree", {"name": "The Smiths"})
        tree = {"tree": "The Smiths"}
        ids = {}
        for name, sex in [("Ada Smith", "female"), ("Ben Smith", "male"), ("Cy Smith", "male")]:
            result = await client.call_tool("add_person", {**tree, "name": name, "sex": sex})
            ids[name] = result.data["id"]
        for child in ("Ben Smith", "Cy Smith"):
            await client.call_tool(
                "add_relationship",
                {
                    **tree,
                    "person_id": ids[child],
                    "relation": "parent",
                    "relative_id": ids["Ada Smith"],
                },
            )
        result = await client.call_tool(
            "get_relationship",
            {**tree, "person_id": ids["Ben Smith"], "relative_id": ids["Cy Smith"]},
        )
        assert result.data["summary"] == "Cy Smith is Ben Smith's brother."
        diagram = await client.call_tool("get_diagram", {**tree, "person_id": ids["Ada Smith"]})
        assert diagram.data.startswith('---\ntitle: "The Smiths"')
        export = await client.call_tool("export_gedcom", tree)
        assert export.data["people"] == 3
        assert "1 NAME Ada /Smith/" in Path(export.data["path"]).read_text()
        await client.call_tool("remove_person", {**tree, "person_id": ids["Cy Smith"]})
        undone = await client.call_tool("undo", tree)
        assert undone.data["people"] == 3

        batch = [
            {"name": "Ben Smith"},
            {"name": "Dee Smith", "parents": [ids["Ada Smith"]], "partners": ["Ben Smith"]},
        ]
        added = await client.call_tool("add_people", {**tree, "people": batch})
        assert added.data["possible_duplicates"] == [
            {"new_id": "ben-smith-2", "existing_id": "ben-smith"}
        ]
        merged = await client.call_tool(
            "merge_people", {**tree, "keep_id": "ben-smith", "duplicate_id": "ben-smith-2"}
        )
        assert merged.data["partners"] == [{"id": "dee-smith", "name": "Dee Smith"}]
        await client.call_tool("rename_tree", {**tree, "new_name": "Smith Family"})

    # A fresh server reads the same tree back from disk.
    async with Client(create_server(Store(tmp_path))) as client:
        trees = await client.call_tool("list_trees", {})
        assert trees.data == [{"name": "Smith Family", "description": "", "people": 4}]
        people = await client.call_tool("find_people", {"tree": "smith-family", "query": "ben"})
        assert people.data == [{"id": "ben-smith", "name": "Ben Smith"}]


async def test_errors_are_reported_to_the_agent(tmp_path) -> None:
    async with Client(create_server(Store(tmp_path))) as client:
        with pytest.raises(ToolError, match="No tree named 'Missing'"):
            await client.call_tool("get_tree", {"tree": "Missing"})
