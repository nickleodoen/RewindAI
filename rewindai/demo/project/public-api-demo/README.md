# Public API Design — RewindAI Demo Project

This folder represents the team's API design decisions tracked by RewindAI.

## Branches

- **main** — REST-first public API direction (Alice)
- **graphql-exploration** — GraphQL alternative exploration (Bob)
- **merged-demo** — Merged outcome combining both approaches

## Key Decision

Use REST for public APIs and GraphQL for internal graph-heavy workflows.

## How RewindAI Tracks This

Every decision, fact, and open question is stored as a versioned memory node in a Neo4j graph. Branches allow parallel exploration. Merging combines knowledge with conflict resolution — just like Git merges code.
