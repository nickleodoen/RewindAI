#!/bin/bash
# RewindAI Backend Starter — handles port conflicts automatically
cd "$(dirname "$0")"

# Kill any existing process on port 8000
echo "Checking port 8000..."
lsof -ti :8000 | xargs kill -9 2>/dev/null && echo "Killed existing process on :8000" || echo "Port 8000 is free"
sleep 1

# Check Neo4j
curl -s http://localhost:7474 > /dev/null 2>&1 && echo "Neo4j: running" || echo "Neo4j: not running (start with 'docker compose up -d neo4j')"

# Start uvicorn
echo "Starting RewindAI backend on :8000..."
python3 -m uvicorn app.main:app --reload --port 8000
