"""Context service — extract structured metadata from conversations using Claude API."""

import logging
import json

import anthropic
import httpx

from app.config import settings

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """Given this conversation between a developer and an AI coding assistant, extract:
1. A 2-3 sentence summary of what was discussed
2. All decisions made with their rationale (as JSON array of {content, rationale} objects)
3. All file paths discussed (as JSON array of strings)
4. Key facts established (as JSON array of strings)
5. A compressed version of the conversation (keep decision-making turns, drop verbose tool outputs)

Return ONLY valid JSON with this structure:
{
  "summary": "...",
  "decisions": [{"content": "...", "rationale": "..."}],
  "filesDiscussed": ["..."],
  "keyFacts": ["..."],
  "compressedContext": "..."
}"""


async def extract_context(
    messages: list[dict[str, str]],
) -> dict:
    """Extract structured metadata from a conversation.

    Tries RocketRide first, falls back to direct Claude API.
    """
    # Format messages for extraction
    conversation_text = "\n".join(
        f"[{m['role']}]: {m['content']}" for m in messages
    )

    # Try RocketRide first
    try:
        result = await _extract_via_rocketride(conversation_text)
        if result:
            return result
    except Exception as e:
        logger.warning("RocketRide extraction failed, falling back to Claude: %s", e)

    # Fallback: direct Claude API
    return await _extract_via_claude(conversation_text)


async def _extract_via_rocketride(conversation_text: str) -> dict | None:
    """Send to RocketRide extraction pipeline."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.rocketride_url}/api/v1/pipelines/extraction/run",
                json={"text": conversation_text},
            )
            if response.status_code == 200:
                return response.json()
    except httpx.ConnectError:
        logger.debug("RocketRide not available")
    return None


async def _extract_via_claude(conversation_text: str) -> dict:
    """Extract using direct Claude API call."""
    if not settings.anthropic_api_key:
        logger.warning("No Anthropic API key configured, returning minimal extraction")
        return {
            "summary": f"Conversation with {conversation_text.count('[user]:')} user messages",
            "decisions": [],
            "filesDiscussed": [],
            "keyFacts": [],
            "compressedContext": conversation_text[:2000],
        }

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[
            {
                "role": "user",
                "content": f"{EXTRACTION_PROMPT}\n\nCONVERSATION:\n{conversation_text[:8000]}",
            }
        ],
    )

    text = response.content[0].text
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to extract JSON from the response
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
        logger.error("Failed to parse extraction response")
        return {
            "summary": text[:200],
            "decisions": [],
            "filesDiscussed": [],
            "keyFacts": [],
            "compressedContext": conversation_text[:2000],
        }
