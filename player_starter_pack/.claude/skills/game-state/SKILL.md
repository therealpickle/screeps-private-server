---
name: game-state
description: Read live Screeps game state, run console commands, manage the server, or run a test loop (edit code → deploy → wait → read console/room output → iterate) — use for creeps, structures, rooms, resources, energy, spawns, console execution, deploy, respawn, tick rate, recording
allowed-tools: Bash
---

# Screeps Game State & Server Management

## MCP tools (prefer these when available)

The `screeps` MCP exposes structured tools for common operations. Use these instead of curl where possible.

| Task | Tool | Notes |
|---|---|---|
| Server status + game tick | `screeps_server_status(server, player_dir?)` | |
| Run JS in game sandbox | `screeps_console(server, player_dir, expr)` | output is async — check console output |
| Deploy bot code | `screeps_deploy(server, player_dir)` | |
| Start recording | `screeps_recording_start(server, player_dir)` | captures room state + console output |
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

## Server selection

Current `.screeps.yml`:
!`cat .screeps.yml 2>/dev/null || echo "(no .screeps.yml found — ask the user to run: make init-screeps-yml)"`

Available servers (parsed from above):
!`python3 -c "import re; txt=open('.screeps.yml').read(); servers=re.findall(r'^\s{2}(\w[\w-]*):', txt, re.M); print(', '.join(servers))" 2>/dev/null || echo "(unable to parse)"`

Active server:
!`cat .active-server 2>/dev/null || python3 -c "import re; txt=open('.screeps.yml').read(); s=re.findall(r'^\s{2}(\w[\w-]*):', txt, re.M); print(s[0] if s else 'private')" 2>/dev/null || echo "private"`

Recording status:
!`ls .recording-*.pid 2>/dev/null | sed 's/\.recording-\(.*\)\.pid/\1 (active)/' || echo "(none active)"`

**If the user specified a server** (e.g. `/game-state staging`), write it to `.active-server` now:
```bash
echo "<SERVER_NAME>" > .active-server
```

Extract `host`, `port`, `username`, and `password` from the matching server block in `.screeps.yml`.

---

## Test loop (edit → deploy → observe → iterate)

Use this when testing code changes. Recording must be active to get console and room output.

**Speed tip (local server only):** Use `screeps_set_tick(server="local", ms=1)` to run ticks as fast as the server can process them. The minimum setting is 1ms — the actual tick rate will be limited by server processing time and varies by machine. Push it low and the server will just tick as fast as it can. Restore to a normal rate (e.g. 1000ms) when done. This makes the wait step much faster.

### Step 1 — ensure recording is active
If recording is not active for this server, start it:
```
screeps_recording_start(server, player_dir)
```

### Step 2 — note current position
```bash
BEFORE_TICK=$(curl -s "http://<HOST>:<PORT>/api/game/time?shard=shard0" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['time'])")
BEFORE_TS=$(date +%s%3N)
echo "tick=$BEFORE_TICK ts=$BEFORE_TS"
```

### Step 3 — edit and deploy
Make the code changes, then:
```
screeps_deploy(server, player_dir)
```

### Step 4 — wait for ticks to run
Default: wait 10 ticks. Adjust based on what's being tested.
```bash
TARGET=$((BEFORE_TICK + 10))
while true; do
  CURRENT=$(curl -s "http://<HOST>:<PORT>/api/game/time?shard=shard0" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['time'])")
  [ "$CURRENT" -ge "$TARGET" ] && break
  echo "waiting... tick $CURRENT / $TARGET"
  sleep 2
done
echo "done — at tick $CURRENT"
```

### Step 5 — read console output
```bash
python3 - <<EOF
import json
before_ts = $BEFORE_TS
path = "recording-<SERVER>/console.jsonl"
try:
    with open(path) as f:
        entries = [json.loads(l) for l in f if l.strip()]
    after = [e for e in entries if e.get("ts", 0) > before_ts]
    if not after:
        print("(no console output after deploy)")
    for e in after:
        print(f"[{e['type']}] {e['text']}")
except FileNotFoundError:
    print(f"No console log found at {path} — is recording active?")
EOF
```

### Step 6 — read room state (if needed)
```bash
python3 - <<EOF
import json
before_tick = $BEFORE_TICK
path = "recording-<SERVER>/frames.jsonl"
try:
    with open(path) as f:
        frames = [json.loads(l) for l in f if l.strip()]
    after = [fr for fr in frames if fr.get("tick", 0) > before_tick]
    print(f"{len(after)} frames after tick {before_tick}")
    for fr in after[-3:]:  # show last 3
        print(json.dumps(fr))
except FileNotFoundError:
    print(f"No frames found at {path} — is recording active?")
EOF
```

### Step 7 — iterate
Analyze the output, make further edits, and repeat from step 2.

---

## Authentication (for curl-based operations below)

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
