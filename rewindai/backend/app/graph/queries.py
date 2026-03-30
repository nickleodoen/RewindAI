"""All Cypher queries — never inline Cypher elsewhere."""

# ── Sessions ──────────────────────────────────────────────────────────────────

CREATE_SESSION = """
CREATE (s:Session {
    id: $sessionId,
    branchName: $branchName,
    userId: $userId,
    createdAt: datetime(),
    lastCommittedAt: datetime(),
    originCommitId: $originCommitId,
    originBranch: $originBranch,
    checkoutMode: $checkoutMode
})
FOREACH (_ IN CASE WHEN $reconstructedAt IS NULL THEN [] ELSE [1] END |
    SET s.reconstructedAt = datetime($reconstructedAt)
)
WITH s
MATCH (b:Branch {name: $branchName})
CREATE (s)-[:ON_BRANCH]->(b)
WITH s
MATCH (u:User {id: $userId})
CREATE (s)-[:OWNED_BY]->(u)
RETURN s
"""

LIST_SESSIONS = """
MATCH (s:Session)
RETURN s ORDER BY s.createdAt DESC
"""

GET_SESSION = """
MATCH (s:Session {id: $sessionId})
RETURN s
"""

UPDATE_SESSION_METADATA = """
MATCH (s:Session {id: $sessionId})
SET s.branchName = $branchName,
    s.originCommitId = $originCommitId,
    s.originBranch = $originBranch,
    s.checkoutMode = $checkoutMode
FOREACH (_ IN CASE WHEN $reconstructedAt IS NULL THEN [] ELSE [1] END |
    SET s.reconstructedAt = datetime($reconstructedAt)
)
RETURN s
"""

MARK_SESSION_COMMITTED = """
MATCH (s:Session {id: $sessionId})
SET s.lastCommittedAt = datetime()
RETURN s
"""

# ── Conversation Turns ────────────────────────────────────────────────────────

STORE_TURN = """
CREATE (ct:ConversationTurn {
    id: $turnId,
    sessionId: $sessionId,
    role: $role,
    content: $content,
    branchName: $branchName,
    createdAt: datetime()
})
WITH ct
MATCH (s:Session {id: $sessionId})
CREATE (ct)-[:IN_SESSION]->(s)
RETURN ct
"""

GET_SESSION_TURNS = """
MATCH (ct:ConversationTurn)-[:IN_SESSION]->(s:Session {id: $sessionId})
RETURN ct ORDER BY ct.createdAt ASC
"""

GET_SESSION_TURNS_SINCE = """
MATCH (ct:ConversationTurn)-[:IN_SESSION]->(s:Session {id: $sessionId})
WHERE ct.createdAt > datetime($sinceIso)
RETURN ct ORDER BY ct.createdAt ASC
"""

# ── Compaction Snapshots ──────────────────────────────────────────────────────

STORE_COMPACTION_SNAPSHOT = """
CREATE (cs:CompactionSnapshot {
    id: $snapshotId,
    sessionId: $sessionId,
    branchName: $branchName,
    content: $content,
    tokenCount: $tokenCount,
    createdAt: datetime()
})
WITH cs
MATCH (s:Session {id: $sessionId})
CREATE (cs)-[:IN_SESSION]->(s)
RETURN cs
"""

GET_COMPACTION_CHAIN = """
MATCH path = (target:Commit {id: $commitId})-[:PARENT_OF*0..]->(ancestor:Commit)
WITH collect(DISTINCT ancestor) AS lineage
UNWIND lineage AS commit
MATCH (cs:CompactionSnapshot)
WHERE cs.branchName = commit.branchName AND cs.createdAt <= commit.createdAt
RETURN DISTINCT cs ORDER BY cs.createdAt ASC
"""

# ── Memories ──────────────────────────────────────────────────────────────────

STORE_MEMORY = """
CREATE (m:Memory {
    id: $memoryId,
    type: $type,
    content: $content,
    tags: $tags,
    branchName: $branchName,
    sessionId: $sessionId,
    userId: $userId,
    createdAt: datetime()
})
WITH m
MATCH (b:Branch {name: $branchName})
CREATE (m)-[:ON_BRANCH]->(b)
WITH m
MATCH (u:User {id: $userId})
CREATE (m)-[:AUTHORED_BY]->(u)
RETURN m
"""

FIND_MEMORY_BY_FINGERPRINT = """
MATCH (m:Memory)
WHERE m.branchName = $branchName AND m.type = $type AND m.content = $content
RETURN m LIMIT 1
"""

LINK_MEMORY_DEPENDENCY = """
MATCH (m1:Memory {id: $fromId}), (m2:Memory {id: $toId})
CREATE (m1)-[:DEPENDS_ON]->(m2)
"""

LINK_MEMORY_SUPERSEDES = """
MATCH (m1:Memory {id: $newId}), (m2:Memory {id: $oldId})
CREATE (m1)-[:SUPERSEDES]->(m2)
"""

LIST_MEMORIES = """
MATCH (m:Memory)
WHERE m.branchName = $branchName
RETURN m ORDER BY m.createdAt ASC
"""

MEMORIES_AT_COMMIT = """
MATCH path = (target:Commit {id: $commitId})-[:PARENT_OF*0..]->(ancestor:Commit)
WITH collect(DISTINCT ancestor) AS lineage
UNWIND lineage AS commit
MATCH (m:Memory)
WHERE m.branchName = commit.branchName AND m.createdAt <= commit.createdAt
WITH collect(DISTINCT m) AS candidateMemories, lineage
UNWIND candidateMemories AS m
WITH m, lineage
WHERE NOT EXISTS {
    MATCH (m2:Memory)-[:SUPERSEDES]->(m)
    WHERE ANY(commit IN lineage WHERE m2.branchName = commit.branchName AND m2.createdAt <= commit.createdAt)
}
RETURN m ORDER BY m.createdAt ASC
"""

SEARCH_MEMORIES = """
CALL db.index.fulltext.queryNodes('memory_content', $query) YIELD node, score
WHERE node.branchName = $branchName
RETURN node, score ORDER BY score DESC LIMIT 20
"""

# ── Commits ───────────────────────────────────────────────────────────────────

CREATE_COMMIT = """
MATCH (b:Branch {name: $branchName})
OPTIONAL MATCH (b)-[oldHeadRel:HEAD]->(:Commit)
WITH b, collect(oldHeadRel) AS oldHeadRels
OPTIONAL MATCH (parent:Commit {id: $parentCommitId})
CREATE (c:Commit {
    id: $commitId,
    message: $message,
    summary: $summary,
    memoryDeltaCount: $memoryDeltaCount,
    createdAt: datetime(),
    userId: $userId,
    branchName: $branchName,
    isMerge: false,
    conflictsResolved: 0,
    parentIds: CASE
        WHEN $parentCommitId IS NULL THEN []
        ELSE [$parentCommitId]
    END
})
CREATE (c)-[:ON_BRANCH]->(b)
FOREACH (_ IN CASE WHEN parent IS NULL THEN [] ELSE [1] END |
    CREATE (c)-[:PARENT_OF]->(parent)
)
FOREACH (oldHeadRel IN oldHeadRels |
    DELETE oldHeadRel
)
CREATE (b)-[:HEAD]->(c)
WITH c, parent
RETURN c, collect(DISTINCT parent) AS parents
"""

CREATE_MERGE_COMMIT = """
MATCH (b:Branch {name: $branchName})
OPTIONAL MATCH (b)-[oldHeadRel:HEAD]->(:Commit)
WITH b, collect(oldHeadRel) AS oldHeadRels
MATCH (targetParent:Commit {id: $targetParentId})
MATCH (sourceParent:Commit {id: $sourceParentId})
CREATE (c:Commit {
    id: $commitId,
    message: $message,
    summary: $summary,
    memoryDeltaCount: $memoryDeltaCount,
    createdAt: datetime(),
    userId: $userId,
    branchName: $branchName,
    isMerge: true,
    mergeStrategy: $mergeStrategy,
    mergedFromBranch: $mergedFromBranch,
    mergeBaseCommitId: $mergeBaseCommitId,
    conflictsResolved: $conflictsResolved,
    parentIds: [$targetParentId, $sourceParentId]
})
CREATE (c)-[:ON_BRANCH]->(b)
CREATE (c)-[:PARENT_OF]->(targetParent)
CREATE (c)-[:PARENT_OF]->(sourceParent)
FOREACH (oldHeadRel IN oldHeadRels |
    DELETE oldHeadRel
)
CREATE (b)-[:HEAD]->(c)
RETURN c, [targetParent, sourceParent] AS parents
"""

LIST_COMMITS = """
MATCH (c:Commit)
WHERE c.branchName = $branchName
OPTIONAL MATCH (c)-[:PARENT_OF]->(parent:Commit)
WITH c, collect(DISTINCT parent) AS parents
RETURN c, parents ORDER BY c.createdAt DESC
"""

GET_COMMIT = """
MATCH (c:Commit {id: $commitId})
OPTIONAL MATCH (c)-[:ON_BRANCH]->(b:Branch)
OPTIONAL MATCH (c)-[:PARENT_OF]->(parent:Commit)
WITH c, b, collect(DISTINCT parent) AS parents
RETURN c, b, parents
"""

GET_COMMIT_BY_PREFIX = """
MATCH (c:Commit)
WHERE c.id STARTS WITH $ref
OPTIONAL MATCH (c)-[:ON_BRANCH]->(b:Branch)
OPTIONAL MATCH (c)-[:PARENT_OF]->(parent:Commit)
WITH c, b, collect(DISTINCT parent) AS parents
RETURN c, b, parents ORDER BY c.createdAt DESC LIMIT 2
"""

GET_COMMIT_LINEAGE = """
MATCH path = (start:Commit {id: $commitId})-[:PARENT_OF*0..]->(ancestor:Commit)
WITH ancestor, min(length(path)) AS depth
OPTIONAL MATCH (ancestor)-[:PARENT_OF]->(parent:Commit)
WITH ancestor AS c, depth, collect(DISTINCT parent) AS parents
RETURN c, parents, depth ORDER BY depth ASC, c.createdAt DESC
"""

GET_COMMIT_ANCESTORS = """
MATCH path = (start:Commit {id: $commitId})-[:PARENT_OF*0..]->(ancestor:Commit)
WITH ancestor, min(length(path)) AS depth
RETURN ancestor AS c, depth ORDER BY depth ASC, c.createdAt DESC
"""

LINK_COMMIT_PARENT = """
MATCH (c:Commit {id: $commitId}), (parent:Commit {id: $parentCommitId})
MERGE (c)-[:PARENT_OF]->(parent)
RETURN c, parent
"""

# ── Branches ──────────────────────────────────────────────────────────────────

CREATE_BRANCH = """
CREATE (b:Branch {name: $branchName, createdAt: datetime(), createdBy: $userId})
RETURN b
"""

CREATE_BRANCH_FROM_COMMIT = """
CREATE (b:Branch {name: $branchName, createdAt: datetime(), createdBy: $userId})
WITH b
MATCH (c:Commit {id: $sourceCommitId})
CREATE (b)-[:BRANCHED_FROM]->(c)
CREATE (b)-[:HEAD]->(c)
RETURN b, c
"""

LIST_BRANCHES = """
MATCH (b:Branch)
OPTIONAL MATCH (b)-[:HEAD]->(head:Commit)
OPTIONAL MATCH (b)-[:BRANCHED_FROM]->(branchedFrom:Commit)
RETURN b, head, branchedFrom ORDER BY b.createdAt ASC
"""

GET_BRANCH = """
MATCH (b:Branch {name: $branchName})
OPTIONAL MATCH (b)-[:HEAD]->(head:Commit)
OPTIONAL MATCH (b)-[:BRANCHED_FROM]->(branchedFrom:Commit)
RETURN b, head, branchedFrom
"""

REPLACE_BRANCH_HEAD = """
MATCH (b:Branch {name: $branchName})
OPTIONAL MATCH (b)-[oldHeadRel:HEAD]->(:Commit)
WITH b, collect(oldHeadRel) AS oldHeadRels
FOREACH (oldHeadRel IN oldHeadRels |
    DELETE oldHeadRel
)
WITH b
OPTIONAL MATCH (c:Commit {id: $commitId})
FOREACH (_ IN CASE WHEN c IS NULL THEN [] ELSE [1] END |
    CREATE (b)-[:HEAD]->(c)
)
RETURN b, c
"""

# ── Branch Diff ───────────────────────────────────────────────────────────────

BRANCH_DIFF = """
MATCH (m:Memory) WHERE m.branchName = $branchA
AND NOT EXISTS { MATCH (m2:Memory) WHERE m2.branchName = $branchB AND m2.content = m.content }
RETURN m, 'only_a' AS side
UNION ALL
MATCH (m:Memory) WHERE m.branchName = $branchB
AND NOT EXISTS { MATCH (m2:Memory) WHERE m2.branchName = $branchA AND m2.content = m.content }
RETURN m, 'only_b' AS side
"""

# ── Graph Exploration ─────────────────────────────────────────────────────────

GRAPH_NEIGHBORHOOD = """
MATCH (center {id: $nodeId})
OPTIONAL MATCH (center)-[r]-(neighbor)
RETURN center, r, neighbor
"""

BRANCH_TIMELINE = """
MATCH (c:Commit)-[:ON_BRANCH]->(b:Branch {name: $branchName})
OPTIONAL MATCH (c)-[:PARENT_OF]->(parent:Commit)
WITH c, collect(DISTINCT parent) AS parents
RETURN c, parents ORDER BY c.createdAt ASC
"""

BRANCH_FULL_GRAPH = """
MATCH (n)-[:ON_BRANCH]->(b:Branch {name: $branchName})
OPTIONAL MATCH (n)-[r]-(neighbor)
RETURN n, labels(n) AS nLabels, r, type(r) AS relType, neighbor, labels(neighbor) AS neighLabels
"""

# ── Users / Workspaces ────────────────────────────────────────────────────────

ENSURE_USER = """
MERGE (u:User {id: $userId})
ON CREATE SET u.name = $userName, u.createdAt = datetime()
RETURN u
"""

ENSURE_WORKSPACE = """
MATCH (u:User {id: $userId})
MERGE (w:Workspace {userId: $userId})
ON CREATE SET w.createdAt = datetime(), w.mode = 'attached', w.updatedAt = datetime()
MERGE (w)-[:OWNED_BY]->(u)
RETURN w
"""

GET_WORKSPACE = """
MATCH (w:Workspace {userId: $userId})
OPTIONAL MATCH (w)-[:ATTACHED_TO]->(b:Branch)
OPTIONAL MATCH (w)-[:HEAD_AT]->(c:Commit)
OPTIONAL MATCH (w)-[:ACTIVE_SESSION]->(s:Session)
RETURN w, b, c, s
"""

SET_WORKSPACE_STATE = """
MATCH (w:Workspace {userId: $userId})
OPTIONAL MATCH (w)-[oldHead:HEAD_AT]->()
WITH w, collect(oldHead) AS oldHeads
OPTIONAL MATCH (w)-[oldSession:ACTIVE_SESSION]->()
WITH w, oldHeads, collect(oldSession) AS oldSessions
OPTIONAL MATCH (w)-[oldAttached:ATTACHED_TO]->()
WITH w, oldHeads, oldSessions, collect(oldAttached) AS oldAttacheds
FOREACH (oldHead IN oldHeads |
    DELETE oldHead
)
FOREACH (oldSession IN oldSessions |
    DELETE oldSession
)
FOREACH (oldAttached IN oldAttacheds |
    DELETE oldAttached
)
WITH w
SET w.mode = $mode,
    w.originBranch = $originBranch,
    w.originCommitId = $originCommitId,
    w.updatedAt = datetime()
WITH w
OPTIONAL MATCH (c:Commit {id: $headCommitId})
OPTIONAL MATCH (s:Session {id: $sessionId})
OPTIONAL MATCH (b:Branch {name: $branchName})
FOREACH (_ IN CASE WHEN c IS NULL THEN [] ELSE [1] END |
    CREATE (w)-[:HEAD_AT]->(c)
)
FOREACH (_ IN CASE WHEN s IS NULL THEN [] ELSE [1] END |
    CREATE (w)-[:ACTIVE_SESSION]->(s)
)
FOREACH (_ IN CASE WHEN $mode = 'attached' AND b IS NOT NULL THEN [1] ELSE [] END |
    CREATE (w)-[:ATTACHED_TO]->(b)
)
RETURN w
"""

# ── Ensure default branch ────────────────────────────────────────────────────

ENSURE_MAIN_BRANCH = """
MERGE (b:Branch {name: 'main'})
ON CREATE SET b.createdAt = datetime(), b.createdBy = 'system'
RETURN b
"""
