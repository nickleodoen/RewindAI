"""Rebuilds context from Neo4j for checkout/rewind operations."""

import logging

from neo4j import AsyncDriver

from app.graph import queries

logger = logging.getLogger(__name__)


async def build_context_for_checkout(driver: AsyncDriver, commit_id: str) -> list[dict]:
    """Build a messages array to seed a new Claude session from a commit point.

    1. Get Memory nodes at this commit (temporal + supersession exclusion)
    2. Get CompactionSnapshot chain up to this commit
    3. Serialize memories as structured context
    4. Return messages array for a new Claude API session
    """
    # Fetch memories at commit
    memories = []
    async with driver.session() as session:
        result = await session.run(queries.MEMORIES_AT_COMMIT, commitId=commit_id)
        records = await result.data()
        for record in records:
            m = record["m"]
            memories.append({
                "id": m.get("id"),
                "type": m.get("type"),
                "content": m.get("content"),
                "tags": m.get("tags", []),
            })

    # Fetch compaction snapshots
    snapshots = []
    async with driver.session() as session:
        result = await session.run(queries.GET_COMPACTION_CHAIN, commitId=commit_id)
        records = await result.data()
        for record in records:
            cs = record["cs"]
            snapshots.append(cs.get("content", ""))

    # Build context string
    context_parts = []

    if memories:
        context_parts.append("## Team Knowledge at This Point\n")
        grouped: dict[str, list[dict]] = {}
        for mem in memories:
            mem_type = mem.get("type", "fact")
            grouped.setdefault(mem_type, []).append(mem)

        type_labels = {
            "decision": "Decisions",
            "fact": "Facts",
            "context": "Context",
            "action_item": "Action Items",
            "question": "Open Questions",
        }

        for mem_type, label in type_labels.items():
            items = grouped.get(mem_type, [])
            if items:
                context_parts.append(f"### {label}")
                for item in items:
                    tags = ", ".join(item.get("tags", []))
                    tag_str = f" [{tags}]" if tags else ""
                    context_parts.append(f"- {item['content']}{tag_str}")
                context_parts.append("")

    context_text = "\n".join(context_parts)

    # Build messages for new Claude session
    system_message = (
        "You are a team AI assistant with versioned memory. "
        "You have been checked out to a specific point in the team's history. "
        "You know ONLY the information provided below. "
        "If asked about anything not in your context, say you don't have that information.\n\n"
        f"{context_text}"
    )

    messages = [{"role": "user", "content": system_message}]

    # If we have a compaction snapshot, use the latest as conversation seed
    if snapshots:
        messages.append({
            "role": "assistant",
            "content": "I've loaded the team's knowledge up to this point. I'm ready to help. "
            "I have context about: " + ", ".join(
                t for t in ["decisions", "facts", "action items", "open questions"]
                if any(m.get("type") == t.rstrip("s").replace(" ", "_") for m in memories)
            ) + "."
        })

    return messages
