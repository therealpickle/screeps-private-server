# screepsmod-picklenet

Automatically spawns new players who have no rooms.

Every 30 seconds the mod scans all user accounts and places a spawn for any user with no rooms. This bootstraps brand-new accounts — the engine doesn't tick a user's code until they own a room, so they can't self-request a spawn.

## Installation

Place the `screepsmod-picklenet` directory alongside your other mods and add it to your `config.yml`:

```yaml
mods:
  - screepsmod-picklenet
```

## Spawn placement

- Picks a random unowned room (controller at level 0).
- Places `Spawn1` at the nearest walkable tile to room centre (25, 25), keeping a 2-tile border clear.
- Claims the controller at RCL 1 with vanilla downgrade timer (20 000 ticks) and safe mode (20 000 ticks).
- Idempotent: if the user already has a spawn the attempt is skipped.

## Player API

`Game.picklenet` is available in every player's sandbox. No methods are exposed yet — this is a placeholder for future server-side actions callable from bot code.

## Server logs

```
[picklenet] spawning userId=abc123 in W3N4 at (25, 26)
[picklenet] userId=abc123 spawned successfully in W3N4
[picklenet] no unowned rooms available for userId=abc123
```
