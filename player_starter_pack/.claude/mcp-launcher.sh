#!/bin/bash
# Launches the Screeps MCP server using SERVER_REPO_PATH from .env.
# Creates a virtualenv in mcp/.venv on first use if it doesn't exist.
# Called by .mcp.json — do not run directly.
# Created with Claude Code (claude.ai/code)

set -a; [ -f .env ] && . .env; set +a

VENV="$SERVER_REPO_PATH/mcp/.venv"

if [ ! -x "$VENV/bin/python3" ]; then
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -q -r "$SERVER_REPO_PATH/mcp/requirements.txt"
fi

exec "$VENV/bin/python3" "$SERVER_REPO_PATH/mcp/server.py"
# Created with Claude Code (claude.ai/code)
