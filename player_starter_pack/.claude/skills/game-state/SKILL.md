---
name: game-state
description: Read live Screeps game state from the server — use when asked about creeps, structures, rooms, resources, energy, spawns, or anything currently happening in the game
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

## Picklenet room-stream (SSE, per-tick)

Subscribe to live room state updates — one frame pushed per tick for each subscribed room.

```bash
TOKEN=$(curl -s -X POST "http://<HOST>:<PORT>/api/auth/signin" \
  -H "Content-Type: application/json" \
  -d '{"email":"<USERNAME>","password":"<PASSWORD>"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

curl -s -N \
  -H "X-Token: $TOKEN" \
  "http://<HOST>:<PORT>/api/picklenet/room-stream?rooms=W1N1,W2N2"
```

Each SSE frame:
```json
{"tick":12345,"rooms":{"W1N1":[...objects...],"W2N2":[...objects...]}}
```

- `rooms` is a comma-separated list of room names (max 20)
- Objects have the same shape as `/api/game/room-objects` (`type`, `x`, `y`, `user`, `store`, etc.)
- `: heartbeat` comments are sent every 15s to keep the connection alive
- Returns `403` if `roomStream.scope` is set to `own` and a requested room isn't owned by the authenticated player

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
