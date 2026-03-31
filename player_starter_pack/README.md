# Player Setup Guide

## Helpful Links

- [Screeps Documentation](https://docs.screeps.com/) — getting started guides covering scripting basics, creeps, control, and more
- [Screeps Game API](https://docs.screeps.com/api/) — official reference for game objects, prototypes, and constants
- [Screeps Server HTTP API Endpoints](https://github.com/screepers/node-screeps-api/blob/master/docs/Endpoints.md) — community-maintained docs for the `/api/` routes
- [Screeps Server WebSocket Endpoints](https://github.com/screepers/node-screeps-api/blob/master/docs/Websocket_endpoints.md) — subscribing to real-time events (console, cpu, room objects)

## Prerequisites

- `node`/`npm` installed
- Screeps purchased on Steam
- Obtain from administrator:
  - `<SERVER_ADDRESS>`
  - `<SERVER_PASSWORD>`

## Connecting to the Server

1. Open Screeps via Steam
2. On the login screen, click **Change server** in the bottom-left
3. Enter the server details and click **Connect**:
   - **Host:** `<SERVER_ADDRESS>`
   - **Port:** `21025`
   - **Server password:** `<SERVER_PASSWORD>` (if set by admin, otherwise leave blank)

## First Time In

1. Once logged in, you'll see the world map
2. Click **Select room** at the bottom of the screen to pick your starting location
3. Place your first Spawn to begin
4. Set a password via the web form at `http://<SERVER_ADDRESS>:21025/authmod/password/`

## Picklenet Extras

The `picklenet` server adds a few extra features above the base game:

1. A web UI for basic visualization at `http://<SERVER_ADDRESS>:21025/visualizer`
2. An auth system to push code
3. A tool API with live room state streaming — see the [screepsmod-picklenet README](https://github.com/therealpickle/screeps-private-server/blob/main/screepsmod-picklenet/README.md) for full docs

> **Note:** The Screeps server also has a built-in [WebSocket API](https://github.com/screepers/node-screeps-api/blob/master/docs/Websocket_endpoints.md) for subscribing to room updates. If you're already using `screeps-api` for code deployment, that's a natural fit. The picklenet SSE endpoint is a simpler alternative for quick scripts that don't need the full library.

## Changing Your Password

Go to `http://<SERVER_ADDRESS>:21025/authmod/password/` in your browser and fill in the form.

Alternatively, ask the server admin to reset/set it for you.

## Setting Up a Code Repository

### 1. Create a git repo and install the starter kit

```bash
mkdir my-screeps-bot && cd my-screeps-bot
git init
curl -fsSL https://raw.githubusercontent.com/therealpickle/screeps-private-server/main/scripts/install-player-kit.sh | bash
```

### 2. Install dependencies

```bash
make install
```

### 3. Generate `.screeps.yml`

```bash
make init-screeps-yml
```

Open `.screeps.yml` and fill in `<SERVER_ADDRESS>`, `<USERNAME>`, and `<PASSWORD>`.

> Don't commit this file — it contains your password. It's already in `.gitignore`.

### 4. Deploy

```bash
make deploy-private
```

### 5. Verify

Open the Screeps client, go to the **Script** tab, and confirm your code is there.
If your spawn is placed, it will start running on the next tick. Error messages appear on the Console.

---

### Without the Makefile

```bash
npx screeps-api upload --server private default/*.js
```

## Getting an API Token

To use the Screeps HTTP API directly (e.g. for tooling or scripts), you'll need an auth token:

```bash
curl -s -X POST http://<SERVER_ADDRESS>:21025/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"<USERNAME>","password":"<PASSWORD>"}'
```

Returns:
```json
{"ok":1,"token":"<TOKEN>"}
```

Use the token in subsequent requests with the header `X-Token: <TOKEN>`.

> If this returns `Unauthorized`, ask the server admin to reset your password.

## Deploying Code from GitHub Actions

To automatically deploy to the server every time you push to `main`, create `.github/workflows/deploy.yml` in your repo:

```yaml
name: Deploy to Screeps

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm install

      - name: Write .screeps.yml
        run: |
          cat > .screeps.yml << EOF
          servers:
            private:
              host: ${{ secrets.SCREEPS_HOST }}
              port: 21025
              http: true
              username: ${{ secrets.SCREEPS_USERNAME }}
              password: ${{ secrets.SCREEPS_PASSWORD }}
              branch: default
          EOF

      - run: make deploy-private
```

Then add your credentials as GitHub Actions secrets in your repo under **Settings → Secrets and variables → Actions**:

- `SCREEPS_HOST`
- `SCREEPS_USERNAME`
- `SCREEPS_PASSWORD`

## Running a Local Test Server

Before pushing code to the shared server, you can run an identical server on your own machine. See the [server setup guide](https://github.com/therealpickle/screeps-private-server/blob/main/README.md) to get a local instance running, then continue below.

### 1. Add a local entry to `.screeps.yml`

```yaml
servers:
  local:
    host: localhost
    port: 21025
    http: true
    username: <USERNAME>
    password: <PASSWORD>
    branch: default
  private:
    host: <SERVER_ADDRESS>
    port: 21025
    http: true
    username: <USERNAME>
    password: <PASSWORD>
    branch: default
```

### 2. Connect the Screeps client to your local server

1. Open Screeps via Steam
2. On the login screen, click **Change server** in the bottom-left
3. Enter `http://localhost:21025` and click **Connect**
4. Log in with your local server credentials
5. Select a room and place your Spawn

### 3. Deploy and test locally

```bash
make deploy-local
```

Once satisfied, deploy to the shared server:

```bash
make deploy-private
```

## Alternate Languages

JavaScript is the only officially supported language, but the community has tooling for several others:

| Language | Approach | Starter / Tooling |
|---|---|---|
| TypeScript | Compiles to JS | [screeps-typescript-starter](https://github.com/screepers/screeps-typescript-starter) |
| Rust | WebAssembly | [screeps-starter-rust](https://github.com/rustyscreeps/screeps-starter-rust) |
| Python | Transpiles to JS | [screeps-starter-python](https://github.com/daboross/screeps-starter-python) |
| Kotlin | Compiles to JS | [screeps-kotlin-starter](https://github.com/exaV/screeps-kotlin-starter) |
| C# / F# | WebAssembly (.NET 8) | [ScreepsDotNet](https://github.com/thomasfn/ScreepsDotNet) |
| C / C++ | WebAssembly (Emscripten) | [cppreeps](https://github.com/screepers/cppreeps) |

Anything that compiles to WebAssembly (Go, Swift, Zig, etc.) is theoretically possible but requires manually defining the game API bindings.

## Notes

- This is a private server — the in-game tutorial and official shard content do not apply
- If you can see the map but clicking does nothing, the simulation may be paused — let the admin know
