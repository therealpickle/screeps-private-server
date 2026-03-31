# screepsmod-picklenet

Player-facing tool API for the picklenet private server.

## Installation

Add to `config.yml`:

```yaml
mods:
  - screepsmod-picklenet
```

## In-game API

`Game.picklenet` is injected into every player sandbox each tick. No methods are
exposed yet — placeholder for future server-side actions callable from bot code.

## HTTP API

All endpoints use standard Screeps token auth. Get a token via:

```bash
TOKEN=$(curl -s -X POST "http://<HOST>:21025/api/auth/signin" \
  -H "Content-Type: application/json" \
  -d '{"email":"<USERNAME>","password":"<PASSWORD>"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
```

### GET /api/picklenet/room-stream

SSE stream of room state — one frame pushed per tick.

```
GET /api/picklenet/room-stream?rooms=W1N1,W2N2
X-Token: <token>
```

**Query params:**
- `rooms` — comma-separated room names (max 20)

**Response stream:**
```
: ok

data: {"tick":12345,"rooms":{"W1N1":[...objects...],"W2N2":[...objects...]}}
data: {"tick":12346,"rooms":{"W1N1":[...objects...],"W2N2":[...objects...]}}
```

Objects have the same shape as `/api/game/room-objects` — `type`, `x`, `y`,
`user`, `store`, etc. `: heartbeat` comments are sent every 15s.

**Errors:**
- `401` — missing or invalid token
- `400` — no rooms specified, or more than 20
- `403` — no permitted rooms (when scope is `own`)

## Configuration

```yaml
serverConfig:
  roomStream:
    scope: any   # 'any' = any authenticated player may subscribe to any room
                 # 'own' = players may only subscribe to rooms they control
```

## Spawning players

Players place their first spawn via the game client. To manually spawn a player:

```bash
make spawn-user USER=username
```
