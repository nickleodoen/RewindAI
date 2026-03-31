"""Decision service — query and manage decisions across commits."""

import logging

from neo4j import AsyncDriver

from app.graph import queries

logger = logging.getLogger(__name__)


async def get_decisions(
    driver: AsyncDriver, branch: str | None = None
) -> list[dict]:
    """Get all decisions, optionally filtered by branch."""
    async with driver.session() as session:
        if branch:
            result = await session.run(queries.GET_DECISIONS_ON_BRANCH, branch=branch)
        else:
            result = await session.run(queries.GET_ALL_DECISIONS)

        decisions = []
        async for record in result:
            decisions.append({
                "sha": record["sha"],
                "summary": record["summary"] or "",
                "decision": record["decision"],
                "rationale": record["rationale"] or "",
                "timestamp": str(record["timestamp"]) if record["timestamp"] else "",
            })
        return decisions


async def get_file_history(driver: AsyncDriver, file_path: str) -> list[dict]:
    """Get the decision history for a specific file."""
    async with driver.session() as session:
        result = await session.run(queries.GET_FILE_HISTORY, path=file_path)
        entries = []
        async for record in result:
            entries.append({
                "sha": record["sha"],
                "summary": record["summary"] or "",
                "decision": record["decision"] or "",
                "rationale": record["rationale"] or "",
                "timestamp": str(record["timestamp"]) if record["timestamp"] else "",
            })
        return entries
