"""GraphQL schema — internal graph-heavy queries."""

# type Memory { id, type, content, tags, branch, createdAt }
# type Branch { name, headCommit, branchedFrom }
# type Commit { id, message, parents, memories }
# query neighborhood(id) -> [Memory | Commit | Branch]
