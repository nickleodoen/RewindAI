"""Branch, commit, checkout, diff, and timeline services."""

import logging
import uuid
from datetime import datetime

from neo4j import AsyncDriver

from app.graph import queries
from app.chat.context_builder import build_context_for_checkout

logger = logging.getLogger(__name__)


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
) -> dict:
    """Create a new branch, optionally from a specific commit."""
    async with driver.session() as session:
        if source_commit_id:
            result = await session.run(
                queries.CREATE_BRANCH_FROM_COMMIT,
                branchName=branch_name,
                sourceCommitId=source_commit_id,
                userId=user_id,
            )
        else:
            result = await session.run(
                queries.CREATE_BRANCH,
                branchName=branch_name,
                userId=user_id,
            )
        record = await result.single()
        b = record["b"]
        return {"name": b["name"], "created_at": _dt(b.get("createdAt")), "created_by": b.get("createdBy")}


async def list_branches(driver: AsyncDriver) -> list[dict]:
    async with driver.session() as session:
        result = await session.run(queries.LIST_BRANCHES)
        records = await result.data()
        return [
            {"name": r["b"]["name"], "created_at": _dt(r["b"].get("createdAt")), "created_by": r["b"].get("createdBy")}
            for r in records
        ]


async def create_commit(
    driver: AsyncDriver,
    branch_name: str,
    message: str,
    user_id: str = "default",
) -> dict:
    """Create a commit node on a branch."""
    commit_id = str(uuid.uuid4())
    async with driver.session() as session:
        result = await session.run(
            queries.CREATE_COMMIT,
            commitId=commit_id,
            message=message,
            userId=user_id,
            branchName=branch_name,
        )
        record = await result.single()
        c = record["c"]
        return {
            "id": c["id"],
            "message": c["message"],
            "branch_name": c["branchName"],
            "user_id": c.get("userId"),
            "created_at": _dt(c.get("createdAt")),
        }


async def list_commits(driver: AsyncDriver, branch_name: str) -> list[dict]:
    async with driver.session() as session:
        result = await session.run(queries.LIST_COMMITS, branchName=branch_name)
        records = await result.data()
        return [
            {
                "id": r["c"]["id"],
                "message": r["c"]["message"],
                "branch_name": r["c"]["branchName"],
                "user_id": r["c"].get("userId"),
                "created_at": _dt(r["c"].get("createdAt")),
            }
            for r in records
        ]


async def checkout(
    driver: AsyncDriver,
    branch_name: str,
    commit_id: str | None = None,
    user_id: str = "default",
) -> dict:
    """Checkout a branch/commit — create a new session with reconstructed context.

    If commit_id is None, use the latest commit on the branch.
    Returns new session info + the context messages for a new Claude session.
    """
    # Find the target commit
    if commit_id is None:
        async with driver.session() as session:
            result = await session.run(queries.LIST_COMMITS, branchName=branch_name)
            records = await result.data()
            if not records:
                return {"error": f"No commits on branch '{branch_name}'"}
            commit_id = records[0]["c"]["id"]

    # Build context from commit point
    context_messages = await build_context_for_checkout(driver, commit_id)

    # Create new session on this branch
    session_id = str(uuid.uuid4())
    async with driver.session() as session:
        # Ensure user exists
        await session.run(queries.ENSURE_USER, userId=user_id, userName=user_id)
        await session.run(
            queries.CREATE_SESSION,
            sessionId=session_id,
            branchName=branch_name,
            userId=user_id,
        )

    # Store the context injection as conversation turns
    async with driver.session() as session:
        for msg in context_messages:
            turn_id = str(uuid.uuid4())
            await session.run(
                queries.STORE_TURN,
                turnId=turn_id,
                sessionId=session_id,
                role=msg["role"],
                content=msg["content"],
                branchName=branch_name,
            )

    return {
        "session_id": session_id,
        "branch_name": branch_name,
        "commit_id": commit_id,
        "context_messages": context_messages,
        "memory_count": len([m for m in context_messages if "Knowledge" in m.get("content", "")]),
    }


async def diff_branches(driver: AsyncDriver, branch_a: str, branch_b: str) -> dict:
    """Diff two branches — returns memories unique to each."""
    only_a = []
    only_b = []

    async with driver.session() as session:
        result = await session.run(queries.BRANCH_DIFF, branchA=branch_a, branchB=branch_b)
        records = await result.data()
        for record in records:
            m = record["m"]
            mem = {
                "id": m["id"],
                "type": m.get("type", "fact"),
                "content": m.get("content", ""),
                "branch_name": m.get("branchName", ""),
                "tags": m.get("tags", []),
            }
            if record["side"] == "only_a":
                only_a.append(mem)
            else:
                only_b.append(mem)

    return {
        "branch_a": branch_a,
        "branch_b": branch_b,
        "only_a": only_a,
        "only_b": only_b,
    }


async def get_timeline(driver: AsyncDriver, branch_name: str) -> list[dict]:
    """Get commit timeline for a branch."""
    async with driver.session() as session:
        result = await session.run(queries.BRANCH_TIMELINE, branchName=branch_name)
        records = await result.data()
        timeline = []
        for record in records:
            c = record["c"]
            parent = record.get("parent")
            timeline.append({
                "commit": {
                    "id": c["id"],
                    "message": c["message"],
                    "branch_name": c["branchName"],
                    "user_id": c.get("userId"),
                    "created_at": _dt(c.get("createdAt")),
                },
                "parent_id": parent["id"] if parent else None,
            })
        return timeline


async def get_graph_neighborhood(driver: AsyncDriver, node_id: str) -> dict:
    """Get a node and its immediate neighbors for Cytoscape.js rendering."""
    nodes = {}
    edges = []

    async with driver.session() as session:
        result = await session.run(queries.GRAPH_NEIGHBORHOOD, nodeId=node_id)
        records = await result.data()
        for record in records:
            center = record.get("center")
            if center:
                cid = center.get("id") or center.get("name", str(center))
                labels = list(center.labels) if hasattr(center, "labels") else []
                nodes[cid] = {
                    "id": cid,
                    "label": labels[0] if labels else "Node",
                    "type": center.get("type"),
                    "properties": dict(center),
                }

            neighbor = record.get("neighbor")
            if neighbor:
                nid = neighbor.get("id") or neighbor.get("name", str(neighbor))
                labels = list(neighbor.labels) if hasattr(neighbor, "labels") else []
                nodes[nid] = {
                    "id": nid,
                    "label": labels[0] if labels else "Node",
                    "type": neighbor.get("type"),
                    "properties": dict(neighbor),
                }

            rel = record.get("r")
            if rel and center and neighbor:
                cid = center.get("id") or center.get("name", str(center))
                nid = neighbor.get("id") or neighbor.get("name", str(neighbor))
                edges.append({
                    "source": cid,
                    "target": nid,
                    "relationship": rel.type if hasattr(rel, "type") else str(rel),
                })

    return {"nodes": list(nodes.values()), "edges": edges}
