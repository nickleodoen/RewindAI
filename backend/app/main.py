"""FastAPI application — RewindAI backend for context snapshots."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.graph.neo4j_client import get_driver, close_driver, verify_connectivity
from app.graph.schema import init_schema
from app.api.routes import router

logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    logger.info("RewindAI backend starting...")

    # Initialize Neo4j
    driver = await get_driver()
    if await verify_connectivity():
        logger.info("Neo4j connected")
        await init_schema(driver)
    else:
        logger.warning("Neo4j not reachable — some features will be unavailable")

    yield

    # Cleanup
    await close_driver()
    logger.info("RewindAI backend stopped")


app = FastAPI(
    title="RewindAI",
    description="Version-controlled AI memory tied to git commits",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health():
    """Health check with Neo4j status."""
    neo4j_ok = await verify_connectivity()
    return {
        "status": "ok" if neo4j_ok else "degraded",
        "neo4j": "connected" if neo4j_ok else "disconnected",
        "version": "0.2.0",
    }
