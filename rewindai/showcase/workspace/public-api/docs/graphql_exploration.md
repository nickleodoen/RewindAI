# GraphQL Exploration (graphql-exploration branch)

**Decision:** Use GraphQL for the public API to support flexible queries.

**Author:** Bob Kumar

## Rationale

- Graph data maps naturally to GraphQL's nested query model
- Schema stitching simplifies partner integrations
- Flexible queries reduce the number of endpoints

## Action Items

- Evaluate Apollo federation after the merge decision lands
- Benchmark query complexity limits for production
