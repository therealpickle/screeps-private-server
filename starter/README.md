# Player Setup Guide

## Prerequisites

- Screeps purchased on Steam
- Obtain from administrator:
  - `<SERVER_ADDRESS>`
  - `<USERNAME>`
  - `<PASSWORD>`

## Connecting to the Server

1. Open Screeps via Steam
2. On the login screen, click **Change server** in the bottom-left
3. Enter the server details and click **Connect**:
   - **Host:** `<SERVER_ADDRESS>`
   - **Port:** `21025`
4. Log in with your username and password

## First Time In

1. Once logged in, you'll see the world map
2. Click **Select room** at the bottom of the screen to pick your starting location
3. Place your first Spawn to begin
4. Set a password via the web form at `http://<SERVER_ADDRESS>:21025/authmod/password/`

## Setting Up a Code Repository

### With the Makefile (recommended)

The starter kit includes a `Makefile` with shortcuts for common tasks.

#### 1. Copy the starter files

```bash
cp -r /path/to/screeps-private-server/starter/{Makefile,package.json,.gitignore,default} .
```

#### 2. Install dependencies

```bash
make install
```

#### 3. Generate `.screeps.yml`

```bash
make init-screeps-yml
```

Then open `.screeps.yml` and fill in `<SERVER_ADDRESS>`, `<USERNAME>`, and `<PASSWORD>`.

> Don't commit this file — it contains your password.

#### 4. Deploy

```bash
make deploy-private
```

#### 5. Verify

Open the Screeps client, go to the **Script** tab, and confirm your code is there. If your spawn is placed, it will start running on the next tick.

---

### Manual Setup

#### 1. Copy the starter files

```bash
cp -r /path/to/screeps-private-server/starter/{Makefile,package.json,.gitignore,default} .
```

#### 2. Add `screeps-api` to your project

Create a `package.json`:

```json
{
  "name": "my-screeps-bot",
  "version": "1.0.0",
  "private": true,
  "devDependencies": {
    "screeps-api": "^1.16.1"
  }
}
```

Then install:
```bash
npm install
```

#### 3. Configure deployment

Create a `.screeps.yml` file in the root of your repo:

```yaml
servers:
  private:
    host: <SERVER_ADDRESS>
    port: 21025
    http: true
    username: <USERNAME>
    password: <PASSWORD>
    branch: default
```

> Don't commit this file — it contains your password. Add `.screeps.yml` and `node_modules/` to `.gitignore`.

#### 4. Deploy

```bash
npx screeps-api upload --server private default/*.js
```

#### 5. Verify

Open the Screeps client, go to the **Script** tab, and confirm your code is there. If your spawn is placed, it will start running on the next tick.

## Deploying Code from Git

### Option 1: Manual deploy

Run the deploy command whenever you want to push your latest code to the game:

```bash
git pull
make deploy
# or: npx screeps-api upload --server private default/*.js
```

This is the simplest approach — you control exactly when your code updates.

### Option 2: Auto-deploy on push with GitHub Actions

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

      - run: make deploy
```

Then add your credentials as GitHub Actions secrets in your repo under **Settings → Secrets and variables → Actions**:

- `SCREEPS_HOST`
- `SCREEPS_USERNAME`
- `SCREEPS_PASSWORD`

## Running a Local Test Server

Before pushing code to the shared server, you can run an identical server on your own machine. Follow the server setup in this repo's [README](../README.md) to get a local instance running, then continue below.

### 1. Add a local entry to `.screeps.yml`

In your bot repo, add a `local` server alongside your existing `private` entry:

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

Your code will run on the local server. Once satisfied, deploy to the shared server:

```bash
make deploy
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

## Changing Your Password

Go to `http://<SERVER_ADDRESS>:21025/authmod/password/` in your browser and fill in the form.

Alternatively, ask the server admin to reset it for you.

## Notes

- This is a private server — the in-game tutorial and official shard content do not apply
- If you can see the map but clicking does nothing, the simulation may be paused — let the admin know
