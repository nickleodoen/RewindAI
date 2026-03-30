"""Memory extraction via RocketRide pipeline with Claude API fallback."""

import json
import logging
import uuid

import httpx
import anthropic

from app.config import settings

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """Analyze this conversation and extract structured memories. Return ONLY a JSON array.

Each memory object must have:
- "id": unique string (use UUID format)
- "type": one of "decision", "fact", "context", "action_item", "question"
- "content": concise summary of the memory
- "tags": array of relevant keywords
- "depends_on": array of memory IDs this depends on (empty if none)
- "supersedes": array of memory IDs this replaces (empty if none)

Conversation:
{conversation}

Return ONLY the JSON array, no other text."""


async def extract_via_rocketride(conversation_text: str) -> list[dict]:
    """Try RocketRide extraction pipeline first."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.rocketride_url}/api/v1/pipelines/extraction/run",
                json={"conversation": conversation_text},
            )
            response.raise_for_status()
            return response.json()
    except Exception as e:
        logger.warning("RocketRide extraction failed, using fallback: %s", e)
        return await extract_via_claude_fallback(conversation_text)


async def extract_via_claude_fallback(conversation_text: str) -> list[dict]:
    """Direct Claude API extraction as fallback."""
    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            messages=[{
                "role": "user",
                "content": EXTRACTION_PROMPT.format(conversation=conversation_text),
            }],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        memories = json.loads(raw)
        for mem in memories:
            if "id" not in mem or not mem["id"]:
                mem["id"] = str(uuid.uuid4())
        return memories
    except Exception as e:
        logger.error("Claude fallback extraction also failed: %s", e)
        return []


def extract_local_fallback(conversation_text: str) -> list[dict]:
    """Simple keyword-based extraction when no API is available."""
    import re
    memories = []
    lines = conversation_text.split("\n")
    for line in lines:
        content = line.split(":", 1)[-1].strip() if ":" in line else line.strip()
        if not content or len(content) < 10:
            continue
        # Detect type from keywords
        lower = content.lower()
        if any(kw in lower for kw in ["decided", "chose", "chosen", "decision", "we will use", "going with"]):
            mem_type = "decision"
        elif any(kw in lower for kw in ["action item", "todo", "need to", "must", "should", "set up", "implement"]):
            mem_type = "action_item"
        elif any(kw in lower for kw in ["question", "should we", "what if", "how do", "?"]):
            mem_type = "question"
        else:
            mem_type = "fact"
        # Extract simple tags from content
        tags = re.findall(r'\b(?:PostgreSQL|Redis|JWT|API|GraphQL|REST|React|Python|FastAPI|Neo4j|Docker)\b', content, re.IGNORECASE)
        tags = list(set(t.lower() for t in tags))
        memories.append({
            "id": str(uuid.uuid4()),
            "type": mem_type,
            "content": content[:200],
            "tags": tags,
            "depends_on": [],
            "supersedes": [],
        })
    return memories[:10]  # Cap at 10


async def extract_memories(conversation_text: str) -> list[dict]:
    """Extract memories from conversation text. Tries RocketRide → Claude → local."""
    memories = await extract_via_rocketride(conversation_text)
    if not memories:
        logger.info("All API extractors failed, using local keyword extraction")
        memories = extract_local_fallback(conversation_text)
    return memories
