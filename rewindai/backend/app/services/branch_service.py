"""Branch, commit, checkout, diff, and timeline services."""

from __future__ import annotations

from datetime import datetime

from neo4j import AsyncDriver

from app.graph import queries
from app.services.workspace_service import (
    checkout_compat,
    create_commit_on_branch,
    diff_refs,
    get_branch_info,
    resolve_ref,
)


def _dt(val) -> str | None:
    """Convert Neo4j DateTime to ISO string."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    if hasattr(val, "to_native"):
        return val.to_native().isoformat()
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val)


async def create_branch(
    driver: AsyncDriver,
    branch_name: str,
    source_commit_id: str | None = None,
    user_id: str = "default",
    source_ref: str | None = None,
) -> dict:
    """Create a new branch, optionally from a resolved ref."""
    resolved_commit_id = source_commit_id
    if source_ref and not resolved_commit_id:
        resolved = await resolve_ref(driver, source_ref, user_id)
        resolved_commit_id = resolved.get("commit_id")

    async with driver.session() as session:
        await session.run(queries.ENSURE_USER, userId=user_id, userName=user_id)
        if resolved_commit_id:
            await session.run(
                queries.CREATE_BRANCH_FROM_COMMIT,
                branchName=branch_name,
                sourceCommitId=resolved_commit_id,
                userId=user_id,
            )
        else:
            await session.run(
                queries.CREATE_BRANCH,
                branchName=branch_name,
                userId=user_id,
            )

    branch = await get_branch_info(driver, branch_name)
    if not branch:
        raise ValueError(f"Failed to create branch '{branch_name}'")
    return branch


async def list_branches(driver: AsyncDriver) -> list[dict]:
    async with driver.session() as session:
        result = await session.run(queries.LIST_BRANCHES)
        records = await result.data()
        branches = []
        for record in records:
            branch = record["b"]
            head = record.get("head")
            branched_from = record.get("branchedFrom")
            branches.append({
                "name": branch["name"],
                "created_at": _dt(branch.get("createdAt")),
                "created_by": branch.get("createdBy"),
                "head_commit_id": head["id"] if head else None,
                "head_message": head.get("message") if head else None,
                "branched_from_commit_id": branched_from["id"] if branched_from else None,
            })
        return branches


async def create_commit(
    driver: AsyncDriver,
    branch_name: str,
    message: str,
    user_id: str = "default",
    session_id: str | None = None,
) -> dict:
    """Create a commit on a branch, syncing session-derived memories when available."""
    return await create_commit_on_branch(
        driver,
        branch_name=branch_name,
        message=message,
        user_id=user_id,
        session_id=session_id,
    )


async def list_commits(driver: AsyncDriver, branch_name: str) -> list[dict]:
    async with driver.session() as session:
        result = await session.run(queries.LIST_COMMITS, branchName=branch_name)
        records = await result.data()
        commits = []
        for record in records:
            commit = record["c"]
            parent_ids = [parent["id"] for parent in (record.get("parents") or []) if parent]
            commits.append({
                "id": commit["id"],
                "message": commit.get("message", ""),
                "summary": commit.get("summary"),
                "memory_delta_count": int(commit.get("memoryDeltaCount", 0) or 0),
                "branch_name": commit.get("branchName", branch_name),
                "user_id": commit.get("userId"),
                "created_at": _dt(commit.get("createdAt")),
                "parent_id": parent_ids[0] if parent_ids else None,
                "parent_ids": parent_ids or list(commit.get("parentIds", [])),
                "is_merge": bool(commit.get("isMerge")) or len(parent_ids) > 1,
                "merge_strategy": commit.get("mergeStrategy"),
                "merged_from_branch": commit.get("mergedFromBranch"),
                "merge_base_commit_id": commit.get("mergeBaseCommitId"),
                "conflicts_resolved": int(commit.get("conflictsResolved", 0) or 0),
            })
        return commits


async def checkout(
    driver: AsyncDriver,
    branch_name: str,
    commit_id: str | None = None,
    user_id: str = "default",
) -> dict:
    """Compatibility checkout wrapper used by the existing frontend."""
    return await checkout_compat(driver, branch_name, commit_id=commit_id, user_id=user_id)


async def diff_branches(driver: AsyncDriver, branch_a: str, branch_b: str, user_id: str = "default") -> dict:
    """Diff two refs using commit snapshots."""
    return await diff_refs(driver, branch_a, branch_b, user_id=user_id)


async def get_timeline(driver: AsyncDriver, branch_name: str) -> list[dict]:
    """Get commit timeline for a branch."""
    async with driver.session() as session:
        result = await session.run(queries.BRANCH_TIMELINE, branchName=branch_name)
        records = await result.data()
        timeline = []
        for record in records:
            commit = record["c"]
            parent_ids = [parent["id"] for parent in (record.get("parents") or []) if parent]
            timeline.append({
                "commit": {
                    "id": commit["id"],
                    "message": commit.get("message", ""),
                    "summary": commit.get("summary"),
                    "memory_delta_count": int(commit.get("memoryDeltaCount", 0) or 0),
                    "branch_name": commit.get("branchName", branch_name),
                    "user_id": commit.get("userId"),
                    "created_at": _dt(commit.get("createdAt")),
                    "parent_id": parent_ids[0] if parent_ids else None,
                    "parent_ids": parent_ids or list(commit.get("parentIds", [])),
                    "is_merge": bool(commit.get("isMerge")) or len(parent_ids) > 1,
                    "merge_strategy": commit.get("mergeStrategy"),
                    "merged_from_branch": commit.get("mergedFromBranch"),
                    "merge_base_commit_id": commit.get("mergeBaseCommitId"),
                    "conflicts_resolved": int(commit.get("conflictsResolved", 0) or 0),
                },
                "parent_id": parent_ids[0] if parent_ids else None,
            })
        return timeline


def _serialize_props(d: dict) -> dict:
    """Convert all Neo4j types in a dict to JSON-safe values."""
    result = {}
    for key, value in d.items():
        if hasattr(value, "to_native"):
            result[key] = value.to_native().isoformat()
        elif hasattr(value, "isoformat") and not isinstance(value, str):
            result[key] = value.isoformat()
        elif isinstance(value, list):
            result[key] = value
        else:
            result[key] = value
    return result


async def get_graph_neighborhood(driver: AsyncDriver, node_id: str) -> dict:
    """Get a node and its immediate neighbors for Cytoscape.js rendering."""
    nodes = {}
    edges = []

    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (center {id: $nodeId})
            OPTIONAL MATCH (center)-[r]-(neighbor)
            RETURN center, labels(center) AS centerLabels,
                   neighbor, labels(neighbor) AS neighborLabels,
                   type(r) AS relType
            """,
            nodeId=node_id,
        )
        records = await result.data()
        for record in records:
            center = record.get("center")
            if center:
                cid = center.get("id") or center.get("name", str(center))
                center_labels = record.get("centerLabels", [])
                nodes[cid] = {
                    "id": cid,
                    "label": center_labels[0] if center_labels else "Node",
                    "type": center.get("type"),
                    "properties": _serialize_props(center),
                }

            neighbor = record.get("neighbor")
            if neighbor:
                nid = neighbor.get("id") or neighbor.get("name", str(neighbor))
                neighbor_labels = record.get("neighborLabels", [])
                nodes[nid] = {
                    "id": nid,
                    "label": neighbor_labels[0] if neighbor_labels else "Node",
                    "type": neighbor.get("type"),
                    "properties": _serialize_props(neighbor),
                }

            rel_type = record.get("relType")
            if rel_type and center and neighbor:
                cid = center.get("id") or center.get("name", str(center))
                nid = neighbor.get("id") or neighbor.get("name", str(neighbor))
                edges.append({
                    "source": cid,
                    "target": nid,
                    "relationship": rel_type,
                })

    return {"nodes": list(nodes.values()), "edges": edges}


async def get_branch_graph(driver: AsyncDriver, branch_name: str) -> dict:
    """Get full graph for a branch — all nodes and relationships."""
    nodes = {}
    edges = []

    async with driver.session() as session:
        result = await session.run(queries.BRANCH_FULL_GRAPH, branchName=branch_name)
        records = await result.data()
        for record in records:
            node = record.get("n")
            if node:
                node_id = node.get("id") or node.get("name", str(node))
                node_labels = record.get("nLabels", [])
                nodes[node_id] = {
                    "id": node_id,
                    "label": node_labels[0] if node_labels else "Node",
                    "type": node.get("type"),
                    "properties": _serialize_props(node),
                }

            neighbor = record.get("neighbor")
            if neighbor:
                neighbor_id = neighbor.get("id") or neighbor.get("name", str(neighbor))
                neighbor_labels = record.get("neighLabels", [])
                nodes[neighbor_id] = {
                    "id": neighbor_id,
                    "label": neighbor_labels[0] if neighbor_labels else "Node",
                    "type": neighbor.get("type"),
                    "properties": _serialize_props(neighbor),
                }

            rel_type = record.get("relType")
            if rel_type and node and neighbor:
                source = node.get("id") or node.get("name", str(node))
                target = neighbor.get("id") or neighbor.get("name", str(neighbor))
                edge_key = f"{source}-{rel_type}-{target}"
                if edge_key not in {f"{edge['source']}-{edge['relationship']}-{edge['target']}" for edge in edges}:
                    edges.append({
                        "source": source,
                        "target": target,
                        "relationship": rel_type,
                    })

    return {"nodes": list(nodes.values()), "edges": edges}
