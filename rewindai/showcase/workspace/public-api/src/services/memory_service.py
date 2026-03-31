"""Memory service — versioned knowledge graph operations."""

from dataclasses import dataclass


@dataclass
class MemoryService:
    """Manages versioned memories in the knowledge graph."""

    async def get_memories_at_commit(self, commit_id: str):
        """Temporal query: memories active at a specific commit."""
        ...

    async def diff_branches(self, branch_a: str, branch_b: str):
        """Compare memory states between two branches."""
        ...

    async def merge_branches(self, source: str, target: str):
        """Merge memories with conflict detection."""
        ...
