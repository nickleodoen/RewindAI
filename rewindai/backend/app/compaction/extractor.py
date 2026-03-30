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


async def extract_memories(conversation_text: str) -> list[dict]:
    """Extract memories from conversation text. Tries RocketRide, falls back to Claude."""
    return await extract_via_rocketride(conversation_text)
