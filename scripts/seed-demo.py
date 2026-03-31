"""Seed demo data into Neo4j for the RewindAI VS Code extension demo.

Creates 3 commit snapshots with context, decisions, and file references
that simulate a real development session.

Usage:
    cd backend && python -m scripts.seed-demo
    OR
    python scripts/seed-demo.py
"""

import asyncio
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.graph.neo4j_client import get_driver, close_driver
from app.graph.schema import init_schema
from app.graph import queries
from app.services.snapshot_service import create_snapshot


DEMO_SNAPSHOTS = [
    {
        "sha": "a1b2c3d",
        "branch": "main",
        "commit_message": "Initial project setup with FastAPI + Neo4j",
        "messages": [
            {"role": "user", "content": "Let's set up the project. I'm thinking FastAPI for the backend and Neo4j for the database."},
            {"role": "assistant", "content": "Great choices. FastAPI gives us async support and auto-docs, while Neo4j is perfect for the graph relationships between commits, decisions, and files. I'll set up the project structure with FastAPI, pydantic-settings for config, and the neo4j async driver."},
            {"role": "user", "content": "Should we use SQLAlchemy or raw Cypher?"},
            {"role": "assistant", "content": "For Neo4j, I recommend raw Cypher queries centralized in a queries.py file. SQLAlchemy doesn't support Neo4j well, and an OGM like neomodel adds complexity without benefit for our use case. Raw Cypher gives us full control over graph traversals and temporal queries."},
            {"role": "user", "content": "Makes sense. Let's also decide on the auth approach."},
            {"role": "assistant", "content": "For a hackathon MVP, I suggest starting without auth and adding it later. But if we want it from the start, JWT tokens are the best fit — stateless, works well with our API-first approach, and we can use python-jose for encoding/decoding."},
        ],
        "summary": "Set up FastAPI + Neo4j project. Decided on raw Cypher over OGM, JWT for future auth.",
        "decisions": [
            {"content": "Use FastAPI for backend", "rationale": "Async support, auto-generated docs, Python typing integration", "type": "architecture"},
            {"content": "Use raw Cypher instead of OGM", "rationale": "Full control over graph traversals, no OGM overhead for Neo4j", "type": "architecture"},
            {"content": "JWT for authentication (deferred)", "rationale": "Stateless, API-first friendly, using python-jose", "type": "architecture"},
        ],
        "files_discussed": ["backend/app/main.py", "backend/app/config.py", "backend/app/graph/queries.py"],
    },
    {
        "sha": "d4e5f6g",
        "branch": "main",
        "commit_message": "Implement context snapshot storage in Neo4j",
        "messages": [
            {"role": "user", "content": "Now let's implement the core feature — storing context snapshots when commits happen."},
            {"role": "assistant", "content": "I'll create a CommitSnapshot node type in Neo4j with relationships to ContextBlock nodes (individual messages), Decision nodes, and FileNode references. Each snapshot is keyed by the git commit SHA."},
            {"role": "user", "content": "How do we handle the message ordering?"},
            {"role": "assistant", "content": "Each ContextBlock gets a `sequence` property (integer). When we restore, we ORDER BY sequence ASC to reconstruct the exact message order. This is critical — LLMs are sensitive to message ordering."},
            {"role": "user", "content": "What about token counting?"},
            {"role": "assistant", "content": "I'll add a rough token estimate (chars / 4) for each ContextBlock and a total tokenCount on the CommitSnapshot. For production, we'd use tiktoken, but the approximation works for our purposes. The token count helps us decide whether to compress on restore."},
        ],
        "summary": "Implemented context snapshot storage with CommitSnapshot, ContextBlock, and Decision nodes. Messages ordered by sequence property.",
        "decisions": [
            {"content": "Use sequence numbers for message ordering", "rationale": "LLMs are sensitive to message order, need deterministic reconstruction", "type": "data_model"},
            {"content": "Rough token counting (chars/4)", "rationale": "Good enough for hackathon, avoids tiktoken dependency", "type": "implementation"},
            {"content": "Key snapshots by git commit SHA", "rationale": "Natural 1:1 mapping between git history and context history", "type": "architecture"},
        ],
        "files_discussed": ["backend/app/graph/queries.py", "backend/app/graph/schema.py", "backend/app/services/snapshot_service.py"],
    },
    {
        "sha": "h7i8j9k",
        "branch": "main",
        "commit_message": "Add context extraction and restore flow",
        "messages": [
            {"role": "user", "content": "We need the extraction pipeline — when a snapshot is saved, we should extract decisions, files discussed, and a summary."},
            {"role": "assistant", "content": "I'll create a context_service that sends the conversation to Claude for extraction. It returns structured JSON with summary, decisions, files, and key facts. The RocketRide pipeline is the primary path, with direct Claude API as fallback."},
            {"role": "user", "content": "And the restore flow?"},
            {"role": "assistant", "content": "On restore: 1) Query Neo4j for ContextBlocks ordered by sequence, 2) Build a system prompt with the summary + decisions + compressed context, 3) Start a new Claude session with ONLY this context. The key insight is that the system prompt injection means Claude literally cannot know anything beyond what we give it — no hallucination by construction."},
            {"role": "user", "content": "That's the proof test — restore an old snapshot and verify the agent doesn't know about later work."},
            {"role": "assistant", "content": "Exactly. The proof test: 1) Chat about topic A, snapshot at commit X, 2) Chat about topic B, 3) Restore to commit X, 4) Ask about B — agent must say 'I don't have context about that'. This is the core value prop."},
        ],
        "summary": "Built extraction pipeline (Claude API + RocketRide fallback) and restore flow. System prompt injection ensures no hallucination on restore.",
        "decisions": [
            {"content": "RocketRide for extraction with Claude API fallback", "rationale": "RocketRide handles chunking and structured extraction; Claude API is reliable fallback", "type": "pipeline"},
            {"content": "System prompt injection for context restore", "rationale": "Claude only sees what we inject — no hallucination by construction", "type": "architecture"},
            {"content": "Proof test protocol for demo", "rationale": "Demonstrates the core value: restored agent doesn't know future context", "type": "demo"},
        ],
        "files_discussed": ["backend/app/services/context_service.py", "backend/app/services/snapshot_service.py", "extension/src/context/restorer.ts"],
    },
]


async def seed():
    """Seed demo data into Neo4j."""
    print("Seeding demo data...")

    driver = await get_driver()
    await init_schema(driver)

    # Clear existing data
    async with driver.session() as session:
        await session.run(queries.DELETE_ALL)
    print("Cleared existing data.")

    # Create snapshots
    for i, snap in enumerate(DEMO_SNAPSHOTS):
        result = await create_snapshot(
            driver=driver,
            sha=snap["sha"],
            branch=snap["branch"],
            commit_message=snap["commit_message"],
            messages=snap["messages"],
            summary=snap["summary"],
            decisions=snap["decisions"],
            files_discussed=snap["files_discussed"],
        )
        print(f"  [{i+1}/{len(DEMO_SNAPSHOTS)}] Created snapshot {result['sha'][:7]}: {result['summary'][:60]}")

    # Link parent chain
    async with driver.session() as session:
        await session.run(queries.LINK_PARENT_SNAPSHOT, childSha="d4e5f6g", parentSha="a1b2c3d")
        await session.run(queries.LINK_PARENT_SNAPSHOT, childSha="h7i8j9k", parentSha="d4e5f6g")
    print("  Linked parent chain: h7i8j9k -> d4e5f6g -> a1b2c3d")

    await close_driver()
    print("\nDone! 3 demo snapshots seeded.")
    print("\nDemo flow:")
    print("  1. @rewind /history         — see all 3 snapshots")
    print("  2. @rewind /restore a1b2c3d — restore to initial setup")
    print("  3. Ask about extraction     — agent won't know (it was decided later)")
    print("  4. @rewind /restore h7i8j9k — restore to latest")
    print("  5. Ask about extraction     — agent knows the full story")


if __name__ == "__main__":
    asyncio.run(seed())
