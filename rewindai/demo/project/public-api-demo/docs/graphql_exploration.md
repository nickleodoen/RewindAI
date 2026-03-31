# GraphQL Exploration (graphql-exploration branch)

**Decision:** Use GraphQL for the public application API to support flexible graph-heavy queries.

**Author:** Bob Kumar

## Rationale

- Graph data naturally maps to GraphQL's nested query model
- Schema stitching can simplify partner integrations without duplicating resolver logic
- Flexible queries reduce the number of endpoints needed

## Action Items

- Evaluate Apollo federation after the merge decision lands
