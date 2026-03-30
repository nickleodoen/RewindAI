#!/bin/bash
cd "$(dirname "$0")/.."
python3 scripts/seed_demo.py
echo "Demo data reset!"
