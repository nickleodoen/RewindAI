"""Snapshot service — create, retrieve, and list context snapshots."""

import logging
import uuid
from datetime import datetime, timezone

from neo4j import AsyncDriver

from app.graph import queries

logger = logging.getLogger(__name__)


async def create_snapshot(
    driver: AsyncDriver,
    sha: str,
    branch: str,
    commit_message: str,
    messages: list[dict[str, str]],
    summary: str = "",
    decisions: list[dict[str, str]] | None = None,
    files_discussed: list[str] | None = None,
) -> dict:
    """Create a context snapshot in Neo4j for a given commit SHA."""
    timestamp = datetime.now(timezone.utc).isoformat()
    token_count = sum(len(m.get("content", "")) // 4 for m in messages)  # rough estimate

    async with driver.session() as session:
        # Store the snapshot node
        await session.run(
            queries.STORE_SNAPSHOT,
            sha=sha,
            branch=branch,
            timestamp=timestamp,
            summary=summary or f"Context snapshot with {len(messages)} messages",
            tokenCount=token_count,
            commitMessage=commit_message,
        )

        # Store each message as a ContextBlock
        for i, msg in enumerate(messages):
            await session.run(
                queries.STORE_CONTEXT_BLOCK,
                sha=sha,
                sequence=i,
                role=msg.get("role", "user"),
                content=msg.get("content", ""),
                tokenCount=len(msg.get("content", "")) // 4,
            )

        # Store decisions if provided
        if decisions:
            for d in decisions:
                decision_id = d.get("id", str(uuid.uuid4()))
                await session.run(
                    queries.STORE_DECISION,
                    sha=sha,
                    decisionId=decision_id,
                    content=d.get("content", ""),
                    rationale=d.get("rationale", ""),
                    type=d.get("type", "decision"),
                )

        # Store file references if provided
        if files_discussed:
            for path in files_discussed:
                ext = path.rsplit(".", 1)[-1] if "." in path else ""
                await session.run(
                    queries.STORE_FILE_DISCUSSED,
                    sha=sha,
                    path=path,
                    language=ext,
                )

    logger.info("Snapshot created: %s on %s (%d messages)", sha[:7], branch, len(messages))
    return {"sha": sha, "summary": summary or f"Context snapshot with {len(messages)} messages"}


async def get_snapshot(driver: AsyncDriver, sha: str) -> dict | None:
    """Retrieve a snapshot with its metadata, decisions, and files."""
    async with driver.session() as session:
        result = await session.run(queries.GET_SNAPSHOT_WITH_METADATA, sha=sha)
        record = await result.single()
        if not record:
            return None

        snapshot = dict(record["snapshot"])
        decisions = [dict(d) for d in record["decisions"]]
        files = list(record["files"])

        # Get context blocks
        blocks_result = await session.run(queries.GET_CONTEXT_BLOCKS, sha=sha)
        blocks = []
        async for rec in blocks_result:
            blocks.append({
                "role": rec["role"],
                "content": rec["content"],
                "sequence": rec["sequence"],
            })

        # Build compressed context from blocks
        compressed = "\n".join(
            f"[{b['role']}]: {b['content'][:500]}" for b in blocks[:20]
        )

        return {
            "snapshot": snapshot,
            "decisions": decisions,
            "files": files,
            "context_blocks": blocks,
            "compressed_context": compressed,
        }


async def list_snapshots(
    driver: AsyncDriver, branch: str, limit: int = 10
) -> list[dict]:
    """List recent snapshots on a branch."""
    async with driver.session() as session:
        result = await session.run(
            queries.LIST_SNAPSHOTS_ON_BRANCH,
            branch=branch,
            limit=limit,
        )
        snapshots = []
        async for record in result:
            snapshots.append(dict(record["snapshot"]))
        return snapshots
