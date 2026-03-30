"""Neo4j schema: constraints, indexes, full-text indexes."""

import logging

from neo4j import AsyncDriver

logger = logging.getLogger(__name__)

CONSTRAINTS = [
    "CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE",
    "CREATE CONSTRAINT commit_id IF NOT EXISTS FOR (c:Commit) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT branch_name IF NOT EXISTS FOR (b:Branch) REQUIRE b.name IS UNIQUE",
    "CREATE CONSTRAINT session_id IF NOT EXISTS FOR (s:Session) REQUIRE s.id IS UNIQUE",
    "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE",
    "CREATE CONSTRAINT workspace_user_id IF NOT EXISTS FOR (w:Workspace) REQUIRE w.userId IS UNIQUE",
    "CREATE CONSTRAINT compaction_snapshot_id IF NOT EXISTS FOR (cs:CompactionSnapshot) REQUIRE cs.id IS UNIQUE",
    "CREATE CONSTRAINT conversation_turn_id IF NOT EXISTS FOR (ct:ConversationTurn) REQUIRE ct.id IS UNIQUE",
]

INDEXES = [
    "CREATE INDEX memory_created_at IF NOT EXISTS FOR (m:Memory) ON (m.createdAt)",
    "CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.type)",
    "CREATE INDEX commit_created_at IF NOT EXISTS FOR (c:Commit) ON (c.createdAt)",
    "CREATE INDEX compaction_snapshot_created_at IF NOT EXISTS FOR (cs:CompactionSnapshot) ON (cs.createdAt)",
]

FULLTEXT_INDEXES = [
    "CREATE FULLTEXT INDEX memory_content IF NOT EXISTS FOR (m:Memory) ON EACH [m.content]",
]


async def ensure_schema(driver: AsyncDriver) -> None:
    """Apply all constraints and indexes."""
    async with driver.session() as session:
        for stmt in CONSTRAINTS + INDEXES + FULLTEXT_INDEXES:
            try:
                await session.run(stmt)
            except Exception as e:
                logger.warning("Schema statement skipped: %s — %s", stmt[:60], e)
    logger.info("Neo4j schema ensured (%d constraints, %d indexes)", len(CONSTRAINTS), len(INDEXES) + len(FULLTEXT_INDEXES))
