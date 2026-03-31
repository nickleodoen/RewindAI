"""Neo4j async driver singleton."""

import logging
from neo4j import AsyncGraphDatabase, AsyncDriver

from app.config import settings

logger = logging.getLogger(__name__)

_driver: AsyncDriver | None = None


async def get_driver() -> AsyncDriver:
    """Get or create the Neo4j async driver singleton."""
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
        logger.info("Neo4j driver created: %s", settings.neo4j_uri)
    return _driver


async def close_driver() -> None:
    """Close the Neo4j driver."""
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None
        logger.info("Neo4j driver closed")


async def verify_connectivity() -> bool:
    """Verify Neo4j is reachable."""
    try:
        driver = await get_driver()
        await driver.verify_connectivity()
        return True
    except Exception as e:
        logger.error("Neo4j connectivity check failed: %s", e)
        return False
