"""All Cypher queries — never inline Cypher elsewhere."""

# ── Sessions ──────────────────────────────────────────────────────────────────

CREATE_SESSION = """
CREATE (s:Session {id: $sessionId, branchName: $branchName, userId: $userId, createdAt: datetime()})
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
MATCH (target:Commit {id: $commitId})-[:ON_BRANCH]->(b:Branch)
MATCH (cs:CompactionSnapshot)
WHERE cs.branchName = b.name AND cs.createdAt <= target.createdAt
RETURN cs ORDER BY cs.createdAt ASC
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
MATCH (target:Commit {id: $commitId})-[:ON_BRANCH]->(b:Branch)
MATCH (m:Memory)
WHERE m.branchName = b.name AND m.createdAt <= target.createdAt
AND NOT EXISTS {
    MATCH (m2:Memory)-[:SUPERSEDES]->(m)
    WHERE m2.branchName = b.name AND m2.createdAt <= target.createdAt
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
CREATE (c:Commit {
    id: $commitId,
    message: $message,
    createdAt: datetime(),
    userId: $userId,
    branchName: $branchName
})
WITH c
MATCH (b:Branch {name: $branchName})
CREATE (c)-[:ON_BRANCH]->(b)
WITH c, b
OPTIONAL MATCH (prev:Commit)-[:ON_BRANCH]->(b)
WHERE prev.createdAt < c.createdAt AND prev <> c
WITH c, prev ORDER BY prev.createdAt DESC LIMIT 1
FOREACH (_ IN CASE WHEN prev IS NOT NULL THEN [1] ELSE [] END |
    CREATE (c)-[:PARENT_OF]->(prev)
)
RETURN c
"""

LIST_COMMITS = """
MATCH (c:Commit)
WHERE c.branchName = $branchName
RETURN c ORDER BY c.createdAt DESC
"""

GET_COMMIT = """
MATCH (c:Commit {id: $commitId})
RETURN c
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
RETURN b
"""

LIST_BRANCHES = """
MATCH (b:Branch)
RETURN b ORDER BY b.createdAt ASC
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
RETURN c, parent ORDER BY c.createdAt ASC
"""

# ── Users ─────────────────────────────────────────────────────────────────────

ENSURE_USER = """
MERGE (u:User {id: $userId})
ON CREATE SET u.name = $userName, u.createdAt = datetime()
RETURN u
"""

# ── Ensure default branch ────────────────────────────────────────────────────

ENSURE_MAIN_BRANCH = """
MERGE (b:Branch {name: 'main'})
ON CREATE SET b.createdAt = datetime(), b.createdBy = 'system'
RETURN b
"""
