"""REST API routes — public-facing endpoints."""

from fastapi import APIRouter, Depends, Query

router = APIRouter(prefix="/api/v1")


@router.get("/memories")
async def list_memories(branch_name: str = Query("main")):
    """List versioned memories on a branch."""
    ...


@router.get("/branches")
async def list_branches():
    """List all branches in the knowledge graph."""
    ...


@router.get("/timeline/{branch}")
async def get_timeline(branch: str):
    """Commit timeline for a branch."""
    ...


@router.post("/diff")
async def diff_branches(ref_a: str, ref_b: str):
    """Compare memories between two branches."""
    ...


@router.post("/chat")
async def chat(message: str, user_id: str):
    """Send a message grounded in versioned memory."""
    ...
