# Subagent: Graph Modeler

## Role
Owns Neo4j schema, all Cypher queries, and the graph structure for context snapshots.

## Schema
```
(:CommitSnapshot {sha, branch, timestamp, summary, tokenCount, commitMessage})
  -[:PARENT_OF]->(:CommitSnapshot)
  -[:ON_BRANCH]->(:Branch {name})
  -[:CONTAINS_CONTEXT]->(:ContextBlock {sequence, role, content, tokenCount})
  -[:DISCUSSED]->(:FileNode {path, language})
  -[:MADE_DECISION]->(:Decision {id, content, rationale, type})
  -[:AUTHORED_BY]->(:Author {name, email})

(:Decision)-[:DEPENDS_ON]->(:Decision)
(:Decision)-[:SUPERSEDES]->(:Decision)
(:FileNode)-[:MODIFIED_IN]->(:CommitSnapshot)
(:Branch)-[:BRANCHED_FROM]->(:CommitSnapshot)
```

## Constraints
```cypher
CREATE CONSTRAINT snapshot_sha IF NOT EXISTS FOR (cs:CommitSnapshot) REQUIRE cs.sha IS UNIQUE
CREATE CONSTRAINT branch_name IF NOT EXISTS FOR (b:Branch) REQUIRE b.name IS UNIQUE
CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (d:Decision) REQUIRE d.id IS UNIQUE
CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:FileNode) REQUIRE f.path IS UNIQUE
```

## Key Queries

### Store snapshot
```cypher
MERGE (cs:CommitSnapshot {sha: $sha})
SET cs.branch = $branch, cs.timestamp = datetime($timestamp),
    cs.summary = $summary, cs.tokenCount = $tokenCount,
    cs.commitMessage = $commitMessage
WITH cs
MERGE (b:Branch {name: $branch})
MERGE (cs)-[:ON_BRANCH]->(b)
```

### Restore context
```cypher
MATCH (cs:CommitSnapshot {sha: $sha})-[:CONTAINS_CONTEXT]->(cb:ContextBlock)
RETURN cb.role AS role, cb.content AS content
ORDER BY cb.sequence ASC
```

### Get snapshot with metadata
```cypher
MATCH (cs:CommitSnapshot {sha: $sha})
OPTIONAL MATCH (cs)-[:MADE_DECISION]->(d:Decision)
OPTIONAL MATCH (cs)-[:DISCUSSED]->(f:FileNode)
RETURN cs {.*} AS snapshot,
       collect(DISTINCT d {.*}) AS decisions,
       collect(DISTINCT f.path) AS files
```

### Decision chain for a file
```cypher
MATCH (f:FileNode {path: $path})<-[:DISCUSSED]-(cs:CommitSnapshot)-[:MADE_DECISION]->(d:Decision)
RETURN cs.sha, cs.summary, d.content, d.rationale, cs.timestamp
ORDER BY cs.timestamp ASC
```

### Recent snapshots
```cypher
MATCH (cs:CommitSnapshot)-[:ON_BRANCH]->(b:Branch {name: $branch})
RETURN cs {.*} AS snapshot
ORDER BY cs.timestamp DESC
LIMIT $limit
```

## Must Avoid
- Storing full file contents as ContextBlock nodes
- Queries that scan all nodes (always scope by branch or SHA)
- Missing sequence numbers on ContextBlocks
