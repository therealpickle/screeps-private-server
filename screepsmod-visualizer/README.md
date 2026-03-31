# screepsmod-visualizer

Web UI and game state API for the picklenet private server.

## Installation

Add to `config.yml`:

```yaml
mods:
  - screepsmod-visualizer
```

## Web UI

Available at `http://<HOST>:21025/visualizer`. Login with your server credentials.

Features: real-time room canvas, console log viewer.

## API

Auth uses a session cookie. Login once per session:

```bash
curl -s -c /tmp/viz.cookie -X POST "http://<HOST>:21025/visualizer/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=<USERNAME>&password=<PASSWORD>&next=/visualizer" -o /dev/null
```

| Endpoint | Description |
|---|---|
| `GET /visualizer/api/rooms` | All room names |
| `GET /visualizer/api/terrain?room=<ROOM>` | Terrain for a single room |
| `GET /visualizer/api/terrain-all` | Terrain for all rooms |
| `GET /visualizer/api/room-overview?room=<ROOM>` | Controller owner and RCL |
| `GET /visualizer/api/rooms-summary` | Sources, controller, mineral per room |
| `GET /visualizer/api/users` | User ID → `{username, badge}` map |
| `GET /visualizer/api/objects?room=<ROOM>` | All objects in a room + gameTime |
| `GET /visualizer/api/console-log` | SSE stream of console output |
