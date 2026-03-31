---
name: game-state
description: Read live Screeps game state or run console commands on the server — use when asked about creeps, structures, rooms, resources, energy, spawns, anything currently happening in the game, or when asked to execute something in the game sandbox
allowed-tools: Bash
---

# Screeps Game State

## Server config

Current `.screeps.yml`:
!`cat .screeps.yml 2>/dev/null || echo "(no .screeps.yml found — ask the user to run: make init-screeps-yml)"`

Use the `private` server by default (or whichever the user specifies). Extract `host`, `port`, `username`, and `password` from the relevant server block above.

## Authentication

Several endpoints need a token. Get one with:

```bash
TOKEN=$(curl -s -X POST "http://<HOST>:<PORT>/api/auth/signin" \
  -H "Content-Type: application/json" \
  -d '{"email":"<USERNAME>","password":"<PASSWORD>"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
```

## Screeps API endpoints (private server subset)

**Game time** (current tick) — no auth needed:
```bash
curl -s "http://<HOST>:<PORT>/api/game/time?shard=shard0"
```

**All objects in a room** (creeps, structures, sources, minerals) — no auth needed:
```bash
curl -s "http://<HOST>:<PORT>/api/game/room-objects?room=<ROOM>&shard=shard0" | python3 -m json.tool
```
Objects have a `type` field (creep, spawn, extension, source, controller, etc.), `x`/`y` position, and `user` (owner ID). Creep `body` is `[{type, hits}, ...]`. `store` holds carried resources.

**Room terrain** — token required:
```bash
curl -s -H "X-Token: $TOKEN" "http://<HOST>:<PORT>/api/game/room-terrain?room=<ROOM>&shard=shard0"
```

Note: `/api/auth/me` and `/api/game/user/overview` are not implemented on private servers.

## Visualizer API endpoints

The server also exposes a visualizer API. Auth uses a session cookie:

```bash
# Login (one-time per session)
curl -s -c /tmp/viz.cookie -X POST "http://<HOST>:<PORT>/visualizer/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=<USERNAME>&password=<PASSWORD>&next=/visualizer" -o /dev/null
```

**All users** (IDs and usernames):
```bash
curl -s -b /tmp/viz.cookie "http://<HOST>:<PORT>/visualizer/api/users" | python3 -m json.tool
```

**All rooms summary** (sources, controller owner/level, mineral per room):
```bash
curl -s -b /tmp/viz.cookie "http://<HOST>:<PORT>/visualizer/api/rooms-summary" | python3 -m json.tool
```

**Objects in a room** (same as Screeps API but auth via cookie):
```bash
curl -s -b /tmp/viz.cookie "http://<HOST>:<PORT>/visualizer/api/objects?room=<ROOM>" | python3 -m json.tool
```

## Live room state (per-tick)

Two options depending on use case:

### Picklenet room-stream (SSE — good for quick scripts)

Uses the token from the Authentication section above:

```bash
curl -s -N \
  -H "X-Token: $TOKEN" \
  "http://<HOST>:<PORT>/api/picklenet/room-stream?rooms=W1N1,W2N2"
```

Each SSE frame:
```json
{"tick":12345,"rooms":{"W1N1":[...objects...],"W2N2":[...objects...]}}
```

- Max 20 rooms per connection
- Objects have the same shape as `/api/game/room-objects` (`type`, `x`, `y`, `user`, `store`, etc.)
- `: heartbeat` comments every 15s

### Picklenet console-stream (SSE — your bot's console output)

```bash
curl -s -N \
  -H "X-Token: $TOKEN" \
  "http://<HOST>:<PORT>/api/picklenet/console-stream"
```

Each SSE frame:
```json
{"ts":1234567890123,"text":"hello from my bot","type":"log"}
```

- `type` is `"log"` or `"error"`
- Last 200 messages replayed on connect
- `: heartbeat` comments every 15s

### WebSocket subscriptions (good for bots/apps using screeps-api)

The server's built-in WebSocket API supports per-tick room subscriptions. If the project already uses `screeps-api` for code deployment, this is the natural fit — see the [WebSocket endpoints docs](https://github.com/screepers/node-screeps-api/blob/master/docs/Websocket_endpoints.md).

## Memory

**Read full memory** — returns gzip+base64 encoded JSON (`gz:<base64>`):
```bash
curl -s -H "X-Token: $TOKEN" -H "X-Username: <USERNAME>" \
  "http://<HOST>:<PORT>/api/user/memory"
# decode:
curl -s -H "X-Token: $TOKEN" -H "X-Username: <USERNAME>" \
  "http://<HOST>:<PORT>/api/user/memory" \
  | python3 -c "import sys,json,base64,gzip; d=json.load(sys.stdin)['data']; print(gzip.decompress(base64.b64decode(d[3:])).decode())"
```

Optional `?path=creeps.Archy` to read a sub-path.

**Read a memory segment** (raw string):
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

**Write a memory segment:**
```bash
curl -s -X POST "http://<HOST>:<PORT>/api/user/memory-segment" \
  -H "X-Token: $TOKEN" -H "X-Username: <USERNAME>" \
  -H "Content-Type: application/json" \
  -d '{"segment":0,"data":"your raw string"}'
```

**Per-tick memory stream** (SSE):
```bash
curl -s -N -H "X-Token: $TOKEN" \
  "http://<HOST>:<PORT>/api/picklenet/memory-stream"
```

Each SSE frame:
```json
{"tick":12345,"data":"gz:<base64>"}
```

Decode the data field:
```bash
echo "<base64>" | base64 -d | gunzip
```

## Running console commands

Execute a JS expression in your game sandbox via the API. Output appears in the
console (and in `console-stream` if connected) — there is no synchronous return value.

```bash
curl -s -X POST "http://<HOST>:<PORT>/api/user/console" \
  -H "X-Token: $TOKEN" \
  -H "X-Username: <USERNAME>" \
  -H "Content-Type: application/json" \
  -d '{"expression":"Game.spawns"}'
```

## Finding the player's rooms

Use `rooms-summary` to find rooms where `controller.user` matches the player's ID (from `users`):

```bash
curl -s -b /tmp/viz.cookie "http://<HOST>:<PORT>/visualizer/api/rooms-summary" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
uid = '<USER_ID>'
for room, info in data['summary'].items():
    c = info.get('controller')
    if c and c.get('user') == uid:
        print(room, 'RCL', c.get('level'))
"
```
