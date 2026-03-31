"""GraphQL schema — internal graph-heavy queries."""

# Used for internal workflows where flexible nested queries
# outperform fixed REST endpoints.

SCHEMA = """
type Memory {
    id: ID!
    type: String!
    content: String!
    tags: [String!]!
    branch: String!
    createdAt: DateTime!
}

type Branch {
    name: String!
    headCommit: Commit
    branchedFrom: Commit
}

type Commit {
    id: ID!
    message: String!
    parents: [Commit!]!
    memories: [Memory!]!
}

type Query {
    memories(branch: String!, type: String): [Memory!]!
    branches: [Branch!]!
    neighborhood(id: ID!): [Node!]!
}
"""
