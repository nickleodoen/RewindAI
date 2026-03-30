"""Seed demo data: 2 users, 2 branches, 6 commits, 18 memories, relationships."""

import asyncio
import httpx
from neo4j import GraphDatabase

API = "http://localhost:8000/api/v1"


def clean_database():
    """Clear all data from Neo4j for a clean seed."""
    print("Cleaning database...")
    driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "rewindai"))
    driver.execute_query("MATCH (n) DETACH DELETE n")
    # Re-create main branch
    driver.execute_query("MERGE (b:Branch {name: 'main'}) ON CREATE SET b.createdAt = datetime(), b.createdBy = 'system'")
    driver.close()
    print("Database cleaned.\n")


async def seed():
    clean_database()

    async with httpx.AsyncClient(timeout=30.0) as client:
        print("Seeding RewindAI demo data...\n")

        # ── Create sessions for both users on main ────────────────────────
        print("Creating sessions...")
        alice_session = (await client.post(f"{API}/sessions", json={
            "branch_name": "main", "user_id": "alice"
        })).json()
        bob_session = (await client.post(f"{API}/sessions", json={
            "branch_name": "main", "user_id": "bob"
        })).json()
        print(f"  Alice session: {alice_session['id'][:8]}")
        print(f"  Bob session:   {bob_session['id'][:8]}")

        # ── Memories on main branch ───────────────────────────────────────
        print("\nCreating memories on main...")

        main_memories = [
            # Commit 1: Tech stack decisions
            {"type": "decision", "content": "Using Python/FastAPI for backend, React/TypeScript for frontend", "tags": ["tech-stack", "architecture"], "branch_name": "main", "user_id": "alice"},
            {"type": "decision", "content": "Neo4j chosen as primary database for versioned knowledge graph", "tags": ["database", "architecture"], "branch_name": "main", "user_id": "alice"},
            {"type": "fact", "content": "Team has 2 members: Alice (backend) and Bob (frontend)", "tags": ["team"], "branch_name": "main", "user_id": "alice"},

            # Commit 2: DB Schema
            {"type": "decision", "content": "Memory nodes will have type, content, tags, branchName, and timestamp fields", "tags": ["schema", "database"], "branch_name": "main", "user_id": "alice"},
            {"type": "fact", "content": "7 node types: Memory, CompactionSnapshot, Commit, Branch, Session, User, ConversationTurn", "tags": ["schema"], "branch_name": "main", "user_id": "bob"},

            # Commit 3: REST API chosen
            {"type": "decision", "content": "REST API chosen over GraphQL for the backend API layer", "tags": ["api", "architecture"], "branch_name": "main", "user_id": "bob"},
            {"type": "fact", "content": "REST API will use FastAPI with automatic OpenAPI docs", "tags": ["api"], "branch_name": "main", "user_id": "bob"},
            {"type": "decision", "content": "Using Tanstack Query (React Query) for frontend data fetching", "tags": ["frontend", "data-fetching"], "branch_name": "main", "user_id": "bob"},
            {"type": "action_item", "content": "Set up API route structure: /api/v1/chat, /sessions, /branches, /commits, /memories", "tags": ["api", "todo"], "branch_name": "main", "user_id": "alice"},
            {"type": "question", "content": "Should we support real-time updates via WebSocket or polling?", "tags": ["architecture", "realtime"], "branch_name": "main", "user_id": "bob"},

            # Commit 4: Frontend
            {"type": "decision", "content": "Using Cytoscape.js for graph visualization with cose-bilkent layout", "tags": ["frontend", "visualization"], "branch_name": "main", "user_id": "bob"},
            {"type": "fact", "content": "Frontend uses dark theme (#0a0a0f background) with Tailwind CSS", "tags": ["frontend", "design"], "branch_name": "main", "user_id": "bob"},

            # Commit 5: CI/CD
            {"type": "decision", "content": "Docker Compose for local dev, GitHub Actions for CI", "tags": ["devops", "ci-cd"], "branch_name": "main", "user_id": "alice"},
            {"type": "action_item", "content": "Write Dockerfile for backend and frontend services", "tags": ["devops", "todo"], "branch_name": "main", "user_id": "alice"},
        ]

        memory_ids = []
        for mem in main_memories:
            resp = await client.post(f"{API}/memories", json=mem)
            data = resp.json()
            memory_ids.append(data["id"])
            print(f"  [{data['type']:12}] {data['content'][:60]}")

        # ── Create commits on main ────────────────────────────────────────
        print("\nCreating commits on main...")
        commits = []
        commit_messages = [
            "Initial tech stack decisions",
            "Database schema design",
            "API design — REST chosen",
            "Frontend architecture",
            "CI/CD pipeline setup",
        ]
        for msg in commit_messages:
            resp = await client.post(f"{API}/commits", json={
                "branch_name": "main", "message": msg, "user_id": "alice"
            })
            c = resp.json()
            commits.append(c)
            print(f"  {c['id'][:8]}: {msg}")

        # ── Create branch from commit 3 (REST chosen) ────────────────────
        print("\nCreating 'graphql-exploration' branch from commit 3...")
        source_commit = commits[2]  # "API design — REST chosen"
        resp = await client.post(f"{API}/branches", json={
            "branch_name": "graphql-exploration",
            "source_commit_id": source_commit["id"],
            "user_id": "bob",
        })
        branch = resp.json()
        print(f"  Branch: {branch['name']} (from {source_commit['id'][:8]})")

        # ── Memories on graphql-exploration branch ────────────────────────
        print("\nCreating memories on graphql-exploration...")
        gql_memories = [
            {"type": "decision", "content": "GraphQL chosen instead of REST for the API layer — better for flexible graph queries", "tags": ["api", "architecture", "graphql"], "branch_name": "graphql-exploration", "user_id": "bob",
             "supersedes": [memory_ids[5]]},  # Supersedes "REST API chosen"
            {"type": "fact", "content": "Using Apollo Server with code-first schema generation from Neo4j types", "tags": ["api", "graphql"], "branch_name": "graphql-exploration", "user_id": "bob"},
            {"type": "decision", "content": "Apollo Client chosen for frontend instead of Tanstack Query — native GraphQL support", "tags": ["frontend", "data-fetching", "graphql"], "branch_name": "graphql-exploration", "user_id": "bob",
             "supersedes": [memory_ids[7]]},  # Supersedes "Tanstack Query"
            {"type": "action_item", "content": "Define GraphQL schema: Query { memories, branches, commits } Mutation { chat, commit, branch }", "tags": ["api", "graphql", "todo"], "branch_name": "graphql-exploration", "user_id": "bob"},
        ]

        for mem in gql_memories:
            resp = await client.post(f"{API}/memories", json=mem)
            data = resp.json()
            print(f"  [{data['type']:12}] {data['content'][:60]}")

        # ── Create commit on graphql-exploration ──────────────────────────
        print("\nCommitting on graphql-exploration...")
        resp = await client.post(f"{API}/commits", json={
            "branch_name": "graphql-exploration",
            "message": "API design — GraphQL chosen",
            "user_id": "bob",
        })
        gql_commit = resp.json()
        print(f"  {gql_commit['id'][:8]}: {gql_commit['message']}")

        # ── Summary ───────────────────────────────────────────────────────
        print("\n" + "=" * 60)
        print("Demo data seeded successfully!")
        print(f"  Main branch:    {len(main_memories)} memories, {len(commits)} commits")
        print(f"  GraphQL branch: {len(gql_memories)} memories, 1 commit")
        print(f"  SUPERSEDES:     2 relationships (REST→GraphQL, TanstackQuery→Apollo)")
        print("=" * 60)
        print("\nDemo ready! Try:")
        print("  1. Open http://localhost:5173")
        print("  2. Switch to 'graph' tab to see memory nodes")
        print("  3. Checkout commit 'API design — REST chosen'")
        print("  4. Switch to 'diff' tab: main vs graphql-exploration")


if __name__ == "__main__":
    asyncio.run(seed())
