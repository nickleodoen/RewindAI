#!/bin/bash
# start-services.sh — Start Neo4j + RocketRide for RewindAI
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "═══ RewindAI Services ═══"
echo ""

# Check for ANTHROPIC_API_KEY
if [ -z "$ANTHROPIC_API_KEY" ]; then
  if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
  fi
  if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "⚠ ANTHROPIC_API_KEY not set — RocketRide pipelines will not work"
    echo "  Set it: export ANTHROPIC_API_KEY=sk-ant-..."
    echo "  Or create a .env file with ANTHROPIC_API_KEY=sk-ant-..."
    echo ""
  fi
fi

echo "Starting Neo4j + RocketRide..."
docker compose up -d

echo ""
echo "Waiting for Neo4j to be healthy..."
for i in $(seq 1 30); do
  if docker compose exec -T neo4j wget --quiet --tries=1 --spider http://localhost:7474 2>/dev/null; then
    echo "Neo4j is ready!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Neo4j did not become healthy in 30s — check 'docker compose logs neo4j'"
  fi
  sleep 1
done

echo ""
echo "Service Status:"
echo "  Neo4j Browser:  http://localhost:7474"
echo "  Neo4j Bolt:     bolt://localhost:7687 (user: neo4j / pass: password)"
echo "  RocketRide API: http://localhost:5565"
echo ""
echo "VS Code settings (already defaults):"
echo '  "rewindai.neo4jUri": "bolt://localhost:7687"'
echo '  "rewindai.neo4jUser": "neo4j"'
echo '  "rewindai.neo4jPassword": "password"'
echo ""
echo "To stop: docker compose down"
echo "To reset: docker compose down -v"
