# screepsmod-picklenet

A Screeps private server mod that exposes a `Game.picklenet` API inside player sandboxes, letting bot code trigger server-side actions without leaving the game engine.

## Installation

Place the `screepsmod-picklenet` directory alongside your other mods and add it to your `config.yml`:

```yaml
mods:
  - screepsmod-picklenet
```

## API

### `Game.picklenet.requestSpawn([options])`

Requests that the server place a spawn for the calling user.

**Options** (all optional):

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Spawn name. Defaults to `'Spawn1'`. |
| `room` | string | Room to spawn in (e.g. `'W3N4'`). Must be unowned. If omitted, a random unowned room is chosen. |
| `x` | number | X coordinate. Must be paired with `y`. Requires `room` to also be specified. |
| `y` | number | Y coordinate. Must be paired with `x`. Requires `room` to also be specified. |

**Constraints:**
- `x` and `y` must be specified together or not at all.
- If `x`/`y` are given, `room` must also be given.
- Throws immediately (visible in your console) if arguments are inconsistent.

**Behavior:**
- If `room` is omitted, a random unowned room (controller at level 0) is chosen.
- If `x`/`y` are omitted, the spawn is placed as close to room centre (25, 25) as possible. The 2-tile border is always kept clear.
- Claims the room controller at RCL 1 with a 20 000-tick downgrade timer and safe mode.
- Spawn is inserted with 300 energy (vanilla defaults).
- **Idempotent:** if the user already has any spawn, the request is silently dropped.

**Usage in bot code:**
```js
// Simplest form — random room, nearest-to-centre placement, name 'Spawn1':
Game.picklenet.requestSpawn();

// Choose a specific room:
Game.picklenet.requestSpawn({ room: 'W3N4' });

// Choose room, position, and name:
Game.picklenet.requestSpawn({ name: 'MySpawn', room: 'W3N4', x: 25, y: 26 });
```

**Timing:** The actual spawn is not placed immediately. Requests are batched and processed by a server-side polling loop every ~2 seconds, so expect a short delay between calling `requestSpawn()` and seeing the spawn appear.

## Architecture

The mod has two layers:

**Engine layer** — hooks `driver.getRuntimeData` and `driver.config.makeGameObject` to inject the `Game.picklenet` object into every player's sandbox each tick. Calling any `Game.picklenet` method enqueues work into a module-level queue — no DB writes happen on the hot path.

**Polling layer** — a `setInterval` drains the pending queue every 2 seconds, performs DB writes, and logs the result. A 3-second startup delay lets `config.common` finish initialising before the poller touches storage.

## Server logs

Spawn activity is logged with the `[picklenet]` prefix:

```
[picklenet] spawning userId=abc123 in W3N4 at (25, 26)
[picklenet] userId=abc123 spawned successfully in W3N4
[picklenet] userId=abc123 already has a spawn in W3N4, ignoring request
[picklenet] no unowned rooms available for userId=abc123
```
