# Screeps Bot

This is a Screeps bot repository targeting a private server. Screeps is a 4x game
(eXplore, eXpand, eXploit, eXteriminat) where the player writes code to control
a bot. That code is deployed to a server and is run with other player's bots. Each
player determines their own goals and strategies.

## Documentation

### Game
- [Screeps Documentation](https://docs.screeps.com/) — concepts, mechanics, tutorials
- [Screeps Game API](https://docs.screeps.com/api/) — full reference for all game objects and methods (Game, Memory, RoomPosition, RoomVisual, constants, etc.)
- [Screeps Wiki](https://wiki.screepspl.us/) — community wiki covering advanced mechanics, formulas, and strategies

### Private server API
- [HTTP API Endpoints](https://github.com/screepers/node-screeps-api/blob/master/docs/Endpoints.md) — server REST API (`/api/game/room-objects`, `/api/game/time`, etc.)
- [WebSocket Endpoints](https://github.com/screepers/node-screeps-api/blob/master/docs/Websocket_endpoints.md) — real-time subscriptions (room objects, console, cpu)
- [screepsmod-picklenet API](https://github.com/therealpickle/screeps-private-server/blob/main/screepsmod-picklenet/README.md) — custom SSE room stream endpoint

### Tooling
- [node-screeps-api](https://github.com/screepers/node-screeps-api) — the npm package used for code deployment in this repo
- [screeps-api CLI docs](https://github.com/screepers/node-screeps-api/blob/master/docs/Screeps_API.md)

## MCP setup

The Screeps MCP gives Claude tools to interact with the server directly (read room state, run
console commands, deploy code, manage a local server, etc.). The `.mcp.json` and launcher script
are already installed by the kit. To activate it, you need a local checkout of the server repo
and a `.env` pointing at it.

### Requirements

1. **Clone the server repo** (if you haven't already):
   ```bash
   git clone https://github.com/therealpickle/screeps-private-server.git /path/to/screeps-private-server
   ```

2. **Create `.env`** in your bot repo with:
   ```
   SERVER_REPO_PATH=/path/to/screeps-private-server
   ```
   `.env` is already gitignored.

3. **Restart Claude Code** — it will pick up the MCP server on next launch. The first start
   auto-creates a Python virtualenv at `$SERVER_REPO_PATH/mcp/.venv`.

### `/picklenet` skill

The `/picklenet` skill is a slash command that primes Claude with full context for server
interaction. It uses MCP tools for all structured operations (game state, deploy, server
management) and falls back to curl only for things without MCP equivalents (terrain, raw
memory, WebSocket). Invoke it when you want Claude to:

- Read live room state, creeps, structures, energy, or spawns
- Run expressions in the game sandbox (`screeps_console`)
- Deploy code and observe the results across ticks (edit → deploy → wait → read → iterate)
- Manage a local server (start, stop, fresh start, set tick rate, respawn)

```
/picklenet
```

You can also pass a server name to target a specific entry from `.screeps.yml`:

```
/picklenet staging
```

The skill reads `.screeps.yml` and `.active-server` at invocation time, so Claude always
knows which server to use without you having to repeat it.

### Verifying it works

Ask Claude: *"What's the current server status?"* — it should call `screeps_server_status`
without needing you to explain anything further.

### Local server management (optional)

To enable start/stop/wipe/respawn tools for a local Docker-based server, add `server_repo` and
`server_type` to the relevant entry in `.screeps.yml`:

```yaml
servers:
  local:
    host: localhost
    port: 21025
    http: true
    username: <USERNAME>
    password: <PASSWORD>
    branch: default
    server_type: local
    server_repo: /path/to/screeps-private-server
```

## Private server notes

- This is a **private server** — the in-game tutorial, seasonal content, and official shard data do not apply
- Server address and credentials are in `.screeps.yml` (gitignored)
- To read live game state, use the `/picklenet` skill
- `Game.picklenet` is available in the sandbox but has no methods yet
