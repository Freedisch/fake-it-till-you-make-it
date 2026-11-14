#!/usr/bin/env bash
# One-command local run: creates the venv on first use, then starts the dev server.
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "First run: creating .venv and installing requirements…"
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
[ -f .env ] || cp .env.example .env
exec .venv/bin/python dev_server.py
