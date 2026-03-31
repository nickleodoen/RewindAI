"""All Cypher queries — never inline Cypher anywhere else."""

# ─── Snapshots ───────────────────────────────────────────────────────────────

STORE_SNAPSHOT = """
MERGE (cs:CommitSnapshot {sha: $sha})
SET cs.branch = $branch,
    cs.timestamp = datetime($timestamp),
    cs.summary = $summary,
    cs.tokenCount = $tokenCount,
    cs.commitMessage = $commitMessage
WITH cs
MERGE (b:Branch {name: $branch})
MERGE (cs)-[:ON_BRANCH]->(b)
RETURN cs.sha AS sha
"""

STORE_CONTEXT_BLOCK = """
MATCH (cs:CommitSnapshot {sha: $sha})
CREATE (cb:ContextBlock {
    sequence: $sequence,
    role: $role,
    content: $content,
    tokenCount: $tokenCount
})
CREATE (cs)-[:CONTAINS_CONTEXT]->(cb)
"""

LINK_PARENT_SNAPSHOT = """
MATCH (child:CommitSnapshot {sha: $childSha})
MATCH (parent:CommitSnapshot {sha: $parentSha})
MERGE (child)-[:PARENT_OF]->(parent)
"""

# ─── Restore ─────────────────────────────────────────────────────────────────

GET_SNAPSHOT = """
MATCH (cs:CommitSnapshot {sha: $sha})
RETURN cs {.*} AS snapshot
"""

GET_SNAPSHOT_WITH_METADATA = """
MATCH (cs:CommitSnapshot {sha: $sha})
OPTIONAL MATCH (cs)-[:MADE_DECISION]->(d:Decision)
OPTIONAL MATCH (cs)-[:DISCUSSED]->(f:FileNode)
RETURN cs {.*} AS snapshot,
       collect(DISTINCT d {.*}) AS decisions,
       collect(DISTINCT f.path) AS files
"""

GET_CONTEXT_BLOCKS = """
MATCH (cs:CommitSnapshot {sha: $sha})-[:CONTAINS_CONTEXT]->(cb:ContextBlock)
RETURN cb.role AS role, cb.content AS content, cb.sequence AS sequence
ORDER BY cb.sequence ASC
"""

# ─── Decisions ───────────────────────────────────────────────────────────────

STORE_DECISION = """
MATCH (cs:CommitSnapshot {sha: $sha})
MERGE (d:Decision {id: $decisionId})
SET d.content = $content, d.rationale = $rationale, d.type = $type
MERGE (cs)-[:MADE_DECISION]->(d)
"""

LINK_DECISION_DEPENDS_ON = """
MATCH (d1:Decision {id: $fromId})
MATCH (d2:Decision {id: $toId})
MERGE (d1)-[:DEPENDS_ON]->(d2)
"""

LINK_DECISION_SUPERSEDES = """
MATCH (d1:Decision {id: $newId})
MATCH (d2:Decision {id: $oldId})
MERGE (d1)-[:SUPERSEDES]->(d2)
"""

GET_DECISIONS_ON_BRANCH = """
MATCH (cs:CommitSnapshot)-[:ON_BRANCH]->(b:Branch {name: $branch})
MATCH (cs)-[:MADE_DECISION]->(d:Decision)
RETURN cs.sha AS sha, cs.summary AS summary,
       d.content AS decision, d.rationale AS rationale,
       cs.timestamp AS timestamp
ORDER BY cs.timestamp ASC
"""

GET_ALL_DECISIONS = """
MATCH (cs:CommitSnapshot)-[:MADE_DECISION]->(d:Decision)
RETURN cs.sha AS sha, cs.summary AS summary,
       d.content AS decision, d.rationale AS rationale,
       cs.timestamp AS timestamp
ORDER BY cs.timestamp DESC
"""

# ─── Files ───────────────────────────────────────────────────────────────────

STORE_FILE_DISCUSSED = """
MATCH (cs:CommitSnapshot {sha: $sha})
MERGE (f:FileNode {path: $path})
ON CREATE SET f.language = $language
MERGE (cs)-[:DISCUSSED]->(f)
MERGE (f)-[:MODIFIED_IN]->(cs)
"""

GET_FILE_HISTORY = """
MATCH (f:FileNode {path: $path})<-[:DISCUSSED]-(cs:CommitSnapshot)
OPTIONAL MATCH (cs)-[:MADE_DECISION]->(d:Decision)
RETURN cs.sha AS sha, cs.summary AS summary,
       d.content AS decision, d.rationale AS rationale,
       cs.timestamp AS timestamp
ORDER BY cs.timestamp ASC
"""

# ─── Listing ─────────────────────────────────────────────────────────────────

LIST_SNAPSHOTS_ON_BRANCH = """
MATCH (cs:CommitSnapshot)-[:ON_BRANCH]->(b:Branch {name: $branch})
RETURN cs {.*} AS snapshot
ORDER BY cs.timestamp DESC
LIMIT $limit
"""

LIST_ALL_BRANCHES = """
MATCH (b:Branch)
OPTIONAL MATCH (cs:CommitSnapshot)-[:ON_BRANCH]->(b)
RETURN b.name AS name, count(cs) AS snapshotCount
ORDER BY name
"""

# ─── Graph neighborhood ─────────────────────────────────────────────────────

GET_SNAPSHOT_GRAPH = """
MATCH (cs:CommitSnapshot {sha: $sha})
OPTIONAL MATCH (cs)-[r1]->(n1)
OPTIONAL MATCH (n2)-[r2]->(cs)
RETURN cs, collect(DISTINCT {rel: type(r1), target: n1}) AS outgoing,
       collect(DISTINCT {rel: type(r2), source: n2}) AS incoming
"""

# ─── Cleanup (for seeding/testing) ──────────────────────────────────────────

DELETE_ALL = """
MATCH (n) DETACH DELETE n
"""
