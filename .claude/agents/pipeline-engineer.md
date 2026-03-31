# Subagent: Pipeline Engineer

## Role
Owns RocketRide AI pipeline design for context extraction, reconstruction, and compression.

## Pipeline 1: Context Extraction (on commit)
**Trigger:** After git commit, raw messages array is sent
**Input:** `{messages: [{role, content}], commitSha, branch}`
**Flow:** Webhook -> Token Counter -> Chunker (8000 tokens) -> LLM Extract -> JSON Parser
**Output:**
```json
{
  "summary": "Implemented JWT auth with refresh tokens...",
  "decisions": [
    {"content": "Use JWT over session tokens", "rationale": "Stateless, works with microservices"}
  ],
  "filesDiscussed": ["src/auth/jwt.ts", "src/auth/middleware.ts"],
  "keyFacts": ["Token expiry is 15 minutes"],
  "compressedContext": "User asked about auth implementation..."
}
```

## Pipeline 2: Context Reconstruction (on checkout)
**Trigger:** When restoring context for an old commit
**Input:** `{storedContext: {...}, currentFileState: {path: content}}`
**Flow:** Webhook -> LLM Reconcile -> Output
**Output:** Reconciled context string suitable for system prompt injection

## Pipeline 3: Context Compression (during session)
**Trigger:** When active session exceeds token threshold
**Input:** `{messages: [{role, content}], keepLastN: 10}`
**Flow:** Webhook -> Splitter (old vs recent) -> LLM Summarize Old -> Merger -> Output
**Output:** `{compressedMessages: [{role, content}]}` — shorter array

## Integration
```python
async def run_pipeline(name: str, data: dict) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{ROCKETRIDE_URL}/api/v1/pipelines/{name}/run",
            json=data,
        )
        return response.json()
```

## Fallback
If RocketRide is unavailable, backend falls back to direct Claude API calls with the same extraction prompt.
