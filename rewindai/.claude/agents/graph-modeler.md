# Subagent: Graph Modeler

## Role
Owns Neo4j schema, all Cypher queries, temporal/branching queries, and data integrity.

## Schema
7 node labels: Memory, CompactionSnapshot, Commit, Branch, Session, User, ConversationTurn
13 relationship types: ON_BRANCH, PARENT_OF, BRANCHED_FROM, CREATED_IN, AUTHORED_BY, DEPENDS_ON, SUPERSEDES, EXTRACTED_TO, COMPACTED_FROM, IN_SESSION, OWNED_BY, SNAPSHOT_AT

## Critical Cypher Queries (all go in graph/queries.py)

### Memories at commit point (temporal + supersession exclusion)
```cypher
MATCH (target:Commit {id: $commitId})-[:ON_BRANCH]->(b:Branch)
MATCH (m:Memory)
WHERE m.branchName = b.name AND m.createdAt <= target.createdAt
AND NOT EXISTS {
    MATCH (m2:Memory)-[:SUPERSEDES]->(m)
    WHERE m2.branchName = b.name AND m2.createdAt <= target.createdAt
}
RETURN m ORDER BY m.createdAt ASC
```

### Compaction chain for checkout
```cypher
MATCH (target:Commit {id: $commitId})-[:ON_BRANCH]->(b:Branch)
MATCH (cs:CompactionSnapshot)
WHERE cs.branchName = b.name AND cs.createdAt <= target.createdAt
RETURN cs ORDER BY cs.createdAt ASC
```

### Branch diff
```cypher
MATCH (m:Memory) WHERE m.branchName = $branchA
AND NOT EXISTS { MATCH (m2:Memory) WHERE m2.branchName = $branchB AND m2.content = m.content }
RETURN m, 'only_a' AS side
UNION ALL
MATCH (m:Memory) WHERE m.branchName = $branchB
AND NOT EXISTS { MATCH (m2:Memory) WHERE m2.branchName = $branchA AND m2.content = m.content }
RETURN m, 'only_b' AS side
```

### Create commit with parent linking
```cypher
CREATE (c:Commit {id: $commitId, message: $message, createdAt: datetime(), userId: $userId, branchName: $branchName})
WITH c MATCH (b:Branch {name: $branchName}) CREATE (c)-[:ON_BRANCH]->(b)
WITH c, b OPTIONAL MATCH (prev:Commit)-[:ON_BRANCH]->(b) WHERE prev.createdAt < c.createdAt AND prev <> c
WITH c, prev ORDER BY prev.createdAt DESC LIMIT 1
FOREACH (_ IN CASE WHEN prev IS NOT NULL THEN [1] ELSE [] END | CREATE (c)-[:PARENT_OF]->(prev))
```

Also needed: CREATE_SESSION, STORE_TURN, GET_SESSION_TURNS, STORE_COMPACTION_SNAPSHOT, STORE_MEMORY, LINK_MEMORY_TO_COMMIT, LINK_MEMORY_DEPENDENCY, LINK_MEMORY_SUPERSEDES, LIST_MEMORIES, CREATE_BRANCH, LIST_BRANCHES, LIST_COMMITS, GRAPH_NEIGHBORHOOD, BRANCH_TIMELINE, SEARCH_MEMORIES, ENSURE_USER

## Must Avoid
- Generic "Entity" nodes — be specific
- Queries returning entire graph — always scope by branch + time
- Missing parameters (injection risk)
- Temporal queries that don't account for branch isolation
