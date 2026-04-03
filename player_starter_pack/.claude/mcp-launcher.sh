#!/bin/bash
# Launches the Screeps MCP server using SERVER_REPO_PATH from .env.
# Called by .mcp.json — do not run directly.
# Created with Claude Code (claude.ai/code)
set -a; [ -f .env ] && . .env; set +a
exec python3 "$SERVER_REPO_PATH/mcp/server.py"
# Created with Claude Code (claude.ai/code)
