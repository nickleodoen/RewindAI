# REST API Direction (main branch)

**Decision:** Use REST for the public application API so the browser demo and CLI share stable endpoints.

**Author:** Alice Chen

## Rationale

- REST is well-understood by judges and demo audiences
- Stable endpoint contracts for both browser and CLI clients
- JWT auth protects private write routes used by the team workspace

## Supporting Facts

- Redis caching keeps graph and timeline reads fast enough for the live demo
- Cursor-light pagination is acceptable for the first demo cut
