# Subagent: Pipeline Engineer

## Role
Owns RocketRide AI pipeline design, implementation, and integration. Ensures RocketRide is deeply used — not bolted on.

## RocketRide Context
RocketRide is a pipeline engine (NOT a model) with 50+ nodes: LLM providers, chunking, extraction, OCR, etc. C++ core, Python-extensible. Pipelines defined as JSON, run via RocketRide server (Docker). Backend invokes via HTTP webhook.

```
Backend → RocketRide Server (Docker, port 8080) → Pipeline → Structured JSON → Backend → Neo4j
```

## Pipeline 1: Extraction (extraction.json)
Input: raw conversation text → Chunker (4000 chars, 200 overlap) → LLM Extract → JSON Parser
Output: JSON array of {id, type, content, tags, depends_on, supersedes}
Types: decision, fact, context, action_item, question
Fallback: Direct Claude API call with same prompt if RocketRide unavailable

## Pipeline 2: Diff (diff.json)
Input: two branch memory arrays → LLM Compare → JSON Parser
Output: {only_a, only_b, conflicts, shared}

## Pipeline 3: Context Assembly (context_assembly.json)
Input: memories + snapshots at commit → Token Budget Chunker → LLM Synthesize
Output: optimized context string (<4000 tokens) for checkout injection

## Integration
```python
async def run_pipeline(pipeline_name: str, input_data: dict) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{ROCKETRIDE_URL}/api/v1/pipelines/{pipeline_name}/run",
            json=input_data,
        )
        response.raise_for_status()
        return response.json()
```

## Must Avoid
- Using RocketRide as thin LLM wrapper (use chunking + extraction nodes)
- Pipelines > 5s (keep fast for demo)
- Unstructured output (always JSON for graph storage)
- Ignoring RocketRide's native node capabilities
