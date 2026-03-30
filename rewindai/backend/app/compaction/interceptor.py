"""Handles compaction events — stores snapshot and triggers extraction."""

import logging
import uuid

from neo4j import AsyncDriver

from app.graph import queries
from app.compaction.extractor import extract_memories

logger = logging.getLogger(__name__)


async def handle_compaction_event(
    driver: AsyncDriver,
    session_id: str,
    branch_name: str,
    user_id: str,
    compaction_content: str,
    pre_compaction_messages: list[dict],
    token_count: int = 0,
) -> int:
    """Process a compaction event: store snapshot + extract memories.

    Returns the number of memories extracted.
    """
    snapshot_id = str(uuid.uuid4())

    # 1. Store CompactionSnapshot in Neo4j
    async with driver.session() as session:
        await session.run(
            queries.STORE_COMPACTION_SNAPSHOT,
            snapshotId=snapshot_id,
            sessionId=session_id,
            branchName=branch_name,
            content=compaction_content,
            tokenCount=token_count,
        )
    logger.info("Stored CompactionSnapshot %s for session %s", snapshot_id, session_id)

    # 2. Build conversation text from pre-compaction messages
    conversation_text = "\n".join(
        f"{msg.get('role', 'unknown')}: {msg.get('content', '')}"
        for msg in pre_compaction_messages
        if isinstance(msg.get("content"), str)
    )

    if not conversation_text.strip():
        logger.info("No conversation text to extract from")
        return 0

    # 3. Extract memories via pipeline
    extracted = await extract_memories(conversation_text)
    logger.info("Extracted %d memories from compaction event", len(extracted))

    # 4. Store extracted memories in Neo4j
    async with driver.session() as session:
        for mem in extracted:
            memory_id = mem.get("id", str(uuid.uuid4()))
            await session.run(
                queries.STORE_MEMORY,
                memoryId=memory_id,
                type=mem.get("type", "fact"),
                content=mem.get("content", ""),
                tags=mem.get("tags", []),
                branchName=branch_name,
                sessionId=session_id,
                userId=user_id,
            )
            # Link dependencies
            for dep_id in mem.get("depends_on", []):
                try:
                    await session.run(queries.LINK_MEMORY_DEPENDENCY, fromId=memory_id, toId=dep_id)
                except Exception:
                    pass
            # Link supersedes
            for old_id in mem.get("supersedes", []):
                try:
                    await session.run(queries.LINK_MEMORY_SUPERSEDES, newId=memory_id, oldId=old_id)
                except Exception:
                    pass

    return len(extracted)
