#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_URL="${REWINDAI_API_URL:-http://localhost:8000}"
DEMO_USER="${REWINDAI_USER:-demo}"

cd "$ROOT"

echo "[rewindai-demo] Checking backend readiness at $API_URL/health"
HEALTH_JSON="$(curl -fsS "$API_URL/health")"

python3 - "$HEALTH_JSON" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
neo4j = str(payload.get("neo4j", "unknown"))
if payload.get("status") != "ok":
    raise SystemExit("Backend health check did not return ok.")
if not neo4j.startswith("connected"):
    raise SystemExit(f"Neo4j is not ready: {neo4j}")
print(f"[rewindai-demo] Backend healthy. Neo4j status: {neo4j}")
PY

python3 scripts/seed_demo.py --api-url "$API_URL" --user-id "$DEMO_USER" --verify

cat <<EOF

[rewindai-demo] Reset complete.

Safe demo:
  rewind --user "$DEMO_USER" checkout merged-demo
  open http://localhost:5173 and show the merge diamond, diff, and merged chat state

Live interactive demo:
  rewind --user "$DEMO_USER" checkout main
  rewind --user "$DEMO_USER" log
  rewind --user "$DEMO_USER" diff main graphql-exploration
  rewind --user "$DEMO_USER" merge graphql-exploration --strategy manual

Frontend quick check:
  open http://localhost:5173
  switch to merged-demo for the safe branch-first story

EOF
