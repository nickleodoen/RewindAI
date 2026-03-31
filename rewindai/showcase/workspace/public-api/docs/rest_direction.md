# REST API Direction (main branch)

**Decision:** Use REST for the public application API.

**Author:** Alice Chen

## Rationale

- REST is well-understood by consumers and integration partners
- Stable endpoint contracts for both browser and CLI clients
- JWT auth protects private write routes

## Supporting Facts

- Redis caching keeps reads fast for timeline and graph endpoints
- Cursor-based pagination is acceptable for the initial release
- OpenAPI spec auto-generated from Pydantic models
