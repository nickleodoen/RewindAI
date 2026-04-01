#!/bin/bash
set -e
echo "=== RewindAI Commit-Switching Test ==="

TEST_DIR="/tmp/rewindai-test-$$"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"
git init
echo "# Test Project" > README.md
git add . && git commit -m "commit-1: initial"
COMMIT_1=$(git rev-parse HEAD)

echo "console.log('hello')" > app.js
git add . && git commit -m "commit-2: add app.js"
COMMIT_2=$(git rev-parse HEAD)

echo "console.log('world')" >> app.js
git add . && git commit -m "commit-3: update app.js"
COMMIT_3=$(git rev-parse HEAD)

# Create .rewind structure
mkdir -p .rewind/snapshots .rewind/sessions

# Create a fake snapshot for commit-2 with context
cat > .rewind/snapshots/$COMMIT_2.json << EOF
{
  "commitSha": "$COMMIT_2",
  "branch": "main",
  "timestamp": "2026-03-31T14:00:00Z",
  "commitMessage": "commit-2: add app.js",
  "context": {
    "messages": [
      {"role": "user", "content": "Create a hello world app"},
      {"role": "assistant", "content": "I created app.js with a hello world console.log"}
    ],
    "summary": "Created app.js with hello world. Discussed JavaScript basics.",
    "decisions": [
      {"content": "Using vanilla JavaScript, no framework", "rationale": "Simple project, no need for React"}
    ],
    "filesDiscussed": ["app.js"],
    "scratchpad": ["DECISION: vanilla JS", "EDITED: app.js"]
  },
  "tokenCount": 500,
  "sessionTimestampCutoff": "2026-03-31T14:05:00Z"
}
EOF

# Create a fake snapshot for commit-3 with DIFFERENT context
cat > .rewind/snapshots/$COMMIT_3.json << EOF
{
  "commitSha": "$COMMIT_3",
  "branch": "main",
  "timestamp": "2026-03-31T15:00:00Z",
  "commitMessage": "commit-3: update app.js",
  "context": {
    "messages": [
      {"role": "user", "content": "Create a hello world app"},
      {"role": "assistant", "content": "I created app.js with a hello world console.log"},
      {"role": "user", "content": "Add world to the output"},
      {"role": "assistant", "content": "Added console.log('world') to app.js"}
    ],
    "summary": "Extended app.js to also print world. Two console.log statements now.",
    "decisions": [
      {"content": "Using vanilla JavaScript, no framework", "rationale": "Simple project"},
      {"content": "Separate console.log calls instead of concatenation", "rationale": "Clearer output"}
    ],
    "filesDiscussed": ["app.js", "README.md"],
    "scratchpad": ["DECISION: vanilla JS", "EDITED: app.js", "DECISION: separate console.logs"]
  },
  "tokenCount": 800,
  "sessionTimestampCutoff": "2026-03-31T15:05:00Z"
}
EOF

echo ""
echo "Test repo created at: $TEST_DIR"
echo "Commit 1: $COMMIT_1 (no snapshot — fresh session expected)"
echo "Commit 2: $COMMIT_2 (snapshot with 2 messages, 1 decision)"
echo "Commit 3: $COMMIT_3 (snapshot with 4 messages, 2 decisions)"
echo ""
echo "To test manually:"
echo "1. Open this folder in the Extension Development Host"
echo "2. Git checkout $COMMIT_2 → should see 'Context restored' with 2 messages, 1 decision"
echo "3. Git checkout $COMMIT_3 → should see 'Context restored' with 4 messages, 2 decisions"
echo "4. Git checkout $COMMIT_1 → should see 'No saved context — fresh session'"
echo "5. Ask '@rewind what were we discussing?' at each commit → answers should differ"
echo ""
echo "Test directory: $TEST_DIR"
