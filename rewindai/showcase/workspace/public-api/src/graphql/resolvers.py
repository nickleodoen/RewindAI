"""GraphQL resolvers for internal graph queries."""


async def resolve_memories(branch: str, type_filter: str | None = None):
    """Fetch memories from the knowledge graph."""
    ...


async def resolve_neighborhood(node_id: str):
    """Get connected nodes for graph visualization."""
    ...
