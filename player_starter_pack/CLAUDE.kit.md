# Screeps Bot

This is a Screeps bot repository targeting a private server.

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

## Private server notes

- This is a **private server** — the in-game tutorial, seasonal content, and official shard data do not apply
- Server address and credentials are in `.screeps.yml` (gitignored)
- To read live game state, use the `/game-state` skill
- `Game.picklenet` is available in the sandbox but has no methods yet
