"""Neo4j schema initialization — constraints and indexes."""

import logging
from neo4j import AsyncDriver

logger = logging.getLogger(__name__)

CONSTRAINTS = [
    "CREATE CONSTRAINT snapshot_sha IF NOT EXISTS FOR (cs:CommitSnapshot) REQUIRE cs.sha IS UNIQUE",
    "CREATE CONSTRAINT branch_name IF NOT EXISTS FOR (b:Branch) REQUIRE b.name IS UNIQUE",
    "CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (d:Decision) REQUIRE d.id IS UNIQUE",
    "CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:FileNode) REQUIRE f.path IS UNIQUE",
    "CREATE CONSTRAINT author_email IF NOT EXISTS FOR (a:Author) REQUIRE a.email IS UNIQUE",
]

INDEXES = [
    "CREATE INDEX snapshot_timestamp IF NOT EXISTS FOR (cs:CommitSnapshot) ON (cs.timestamp)",
    "CREATE INDEX snapshot_branch IF NOT EXISTS FOR (cs:CommitSnapshot) ON (cs.branch)",
    "CREATE INDEX context_block_seq IF NOT EXISTS FOR (cb:ContextBlock) ON (cb.sequence)",
    "CREATE INDEX decision_type IF NOT EXISTS FOR (d:Decision) ON (d.type)",
]


async def init_schema(driver: AsyncDriver) -> None:
    """Create all constraints and indexes."""
    async with driver.session() as session:
        for stmt in CONSTRAINTS:
            try:
                await session.run(stmt)
            except Exception as e:
                logger.warning("Constraint may already exist: %s", e)

        for stmt in INDEXES:
            try:
                await session.run(stmt)
            except Exception as e:
                logger.warning("Index may already exist: %s", e)

    logger.info("Neo4j schema initialized (%d constraints, %d indexes)",
                len(CONSTRAINTS), len(INDEXES))
