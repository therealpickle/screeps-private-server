# screepsmod-picklenet

Provides a `Game.picklenet` API surface in every player's sandbox for future
server-side actions.

## Installation

Place the `screepsmod-picklenet` directory alongside your other mods and add it
to your `config.yml`:

```yaml
mods:
  - screepsmod-picklenet
```

## Player API

`Game.picklenet` is available in every player's sandbox. No methods are exposed
yet — this is a placeholder for future server-side actions callable from bot code.

## Spawning players

Players place their first spawn via the game client as normal. To manually spawn
a player (e.g. for testing), use the provided script:

```bash
make spawn-user USER=username
```

Or pipe it directly to the CLI:

```bash
printf 'var USERNAME="alice";\n' | cat - scripts/spawn-user.js \
  | docker compose exec -T screeps cli
```

See `scripts/spawn-user.js` for details on spawn placement logic.
