"""FastAPI application with lifespan, CORS, and health check."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.graph.neo4j_client import get_driver, close_driver
from app.graph.schema import ensure_schema
from app.graph import queries
from app.models.schema import HealthResponse
from app.api.routes import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting RewindAI backend...")
    try:
        driver = await get_driver()
        await ensure_schema(driver)
        async with driver.session() as session:
            await session.run(queries.ENSURE_MAIN_BRANCH)
        logger.info("RewindAI backend ready (Neo4j connected)")
    except Exception as e:
        logger.warning("Neo4j not available at startup: %s — app will retry on first request", e)
    yield
    await close_driver()
    logger.info("RewindAI backend stopped")


app = FastAPI(title="RewindAI", version="0.1.0", lifespan=lifespan)
app.include_router(router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    neo4j_status = "unknown"
    try:
        driver = await get_driver()
        async with driver.session() as session:
            result = await session.run("RETURN 1")
            await result.single()
            neo4j_status = "connected"
    except Exception as e:
        neo4j_status = f"error: {e}"
    return HealthResponse(status="ok", neo4j=neo4j_status)
