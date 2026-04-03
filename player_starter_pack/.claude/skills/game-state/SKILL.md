---
name: game-state
description: Read live Screeps game state, run console commands, or manage the server — use when asked about creeps, structures, rooms, resources, energy, spawns, anything in the game, console execution, deploy, respawn, tick rate, recording, server start/stop
allowed-tools: Bash
---

# Screeps Game State & Server Management

## MCP tools (prefer these when available)

The `screeps` MCP exposes structured tools for common operations. Use these instead of curl where possible.

| Task | Tool | Notes |
|---|---|---|
| Server status + game tick | `screeps_server_status(server, player_dir?)` | |
| Run JS in game sandbox | `screeps_console(server, player_dir, expr)` | output is async — check console-stream |
| Deploy bot code | `screeps_deploy(server, player_dir)` | |
| Start recording | `screeps_recording_start(server, player_dir)` | |
| Stop recording | `screeps_recording_stop(server, player_dir)` | |
| Wipe recording | `screeps_recording_wipe(server, player_dir)` | |
| Spawn user into world | `screeps_respawn(server, user)` | local only |
| Start server | `screeps_server_start(server)` | local only |
| Stop server | `screeps_server_stop(server)` | local only |
| Wipe + init fresh map | `screeps_fresh_start(server, map_key, tick_rate)` | local only |
| Set tick duration | `screeps_set_tick(server, ms)` | local only |

`server` = name from `.screeps.yml` (e.g. `private`, `staging`). Use `local` for the local Docker server.
`player_dir` = absolute path to this repo (where `.screeps.yml` lives).

**MCP not available?** Set `SERVER_REPO_PATH=/path/to/screeps-private-server` in `.env` and restart Claude Code.

---

## Server selection (for curl-based operations below)

Current `.screeps.yml`:
!`cat .screeps.yml 2>/dev/null || echo "(no .screeps.yml found — ask the user to run: make init-screeps-yml)"`

Available servers (parsed from above):
!`python3 -c "import re; txt=open('.screeps.yml').read(); servers=re.findall(r'^\s{2}(\w[\w-]*):', txt, re.M); print(', '.join(servers))" 2>/dev/null || echo "(unable to parse)"`

Active server:
!`cat .active-server 2>/dev/null || python3 -c "import re; txt=open('.screeps.yml').read(); s=re.findall(r'^\s{2}(\w[\w-]*):', txt, re.M); print(s[0] if s else 'private')" 2>/dev/null || echo "private"`

**If the user specified a server** (e.g. `/game-state staging`), write it to `.active-server` now:
```bash
echo "<SERVER_NAME>" > .active-server
```

Extract `host`, `port`, `username`, and `password` from the matching server block in `.screeps.yml`.

## Authentication

```bash
TOKEN=$(curl -s -X POST "http://<HOST>:<PORT>/api/auth/signin" \
  -H "Content-Type: application/json" \
  -d '{"email":"<USERNAME>","password":"<PASSWORD>"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
```

## Room data

**All objects in a room** (creeps, structures, sources, minerals) — no auth needed:
```bash
curl -s "http://<HOST>:<PORT>/api/game/room-objects?room=<ROOM>&shard=shard0" | python3 -m json.tool
```
Objects have a `type` field, `x`/`y` position, `user` (owner ID), `body` (creeps), `store` (resources).

**Room terrain** — token required:
```bash
curl -s -H "X-Token: $TOKEN" "http://<HOST>:<PORT>/api/game/room-terrain?room=<ROOM>&shard=shard0"
```

Note: `/api/auth/me` and `/api/game/user/overview` are not implemented on private servers.

## Live room state (per-tick)

### Picklenet room-stream (SSE)

```bash
curl -s -N \
  -H "X-Token: $TOKEN" \
  "http://<HOST>:<PORT>/api/picklenet/room-stream?rooms=W1N1,W2N2"
```

Each SSE frame:
```json
{"tick":12345,"rooms":{"W1N1":[...objects...],"W2N2":[...objects...]}}
```
Max 20 rooms. Objects same shape as room-objects. Heartbeat every 15s.

### Picklenet console-stream (SSE — bot console output)

```bash
curl -s -N -H "X-Token: $TOKEN" "http://<HOST>:<PORT>/api/picklenet/console-stream"
```

Each frame: `{"ts":1234567890123,"text":"...","type":"log"}` — `type` is `log` or `error`. Last 200 messages replayed on connect.

### WebSocket subscriptions

See [WebSocket endpoints docs](https://github.com/screepers/node-screeps-api/blob/master/docs/Websocket_endpoints.md).

## Memory

**Read full memory** (gzip+base64 encoded):
```bash
curl -s -H "X-Token: $TOKEN" -H "X-Username: <USERNAME>" \
  "http://<HOST>:<PORT>/api/user/memory" \
  | python3 -c "import sys,json,base64,gzip; d=json.load(sys.stdin)['data']; print(gzip.decompress(base64.b64decode(d[3:])).decode())"
```
Optional `?path=creeps.Archy` for a sub-path.

**Read a memory segment:**
```bash
curl -s -H "X-Token: $TOKEN" -H "X-Username: <USERNAME>" \
  "http://<HOST>:<PORT>/api/user/memory-segment?segment=0"
```

**Write memory at a path:**
```bash
curl -s -X POST "http://<HOST>:<PORT>/api/user/memory" \
  -H "X-Token: $TOKEN" -H "X-Username: <USERNAME>" \
  -H "Content-Type: application/json" \
  -d '{"path":"someKey","value":{"foo":42}}'
```

**Per-tick memory stream** (SSE):
```bash
curl -s -N -H "X-Token: $TOKEN" "http://<HOST>:<PORT>/api/picklenet/memory-stream"
```
Each frame: `{"tick":12345,"data":"gz:<base64>"}` — decode with `echo "<base64>" | base64 -d | gunzip`.
