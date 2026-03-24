# Player Setup Guide

## Prerequisites

- Screeps purchased on Steam
- Your username and password (get these from the server admin)

## Connecting to the Server

1. Open Screeps via Steam
2. On the login screen, click **Change server** in the bottom-left
3. Enter the server details and click **Connect** (the admin will provide the host address):
   - **Host:** `<server-address>`
   - **Port:** `21025`
4. Log in with your username and password

> If you don't have credentials yet, ask the server admin to run `make adduser` for you.

## First Time In

1. Once logged in, you'll see the world map
2. Click **Select room** at the bottom of the screen to pick your starting location
3. Place your first Spawn to begin
4. Set a password via the web form at `http://<server-address>:21025/authmod/password/`

## Setting Up a Code Repository

### 1. Create a GitHub repo

Create a new GitHub repo for your bot code, then clone it locally:
```bash
git clone https://github.com/your-username/your-repo.git
cd your-repo
```

### 2. Add `screeps-api` to your project

Create a `package.json` with the deploy script:

```json
{
  "name": "my-screeps-bot",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "deploy": "screeps-api upload --server private default/*.js"
  },
  "devDependencies": {
    "screeps-api": "^1.16.1"
  }
}
```

Then install:
```bash
npm install
```

### 3. Configure deployment

Create a `.screeps.yml` file in the root of your repo:

```yaml
servers:
  private:
    host: <server-address>
    port: 21025
    http: true
    username: your_username
    password: your_password
    branch: default
```

> Don't commit this file — it contains your password. Add `.screeps.yml` and `node_modules/` to `.gitignore`.

### 4. Deploy your code

```bash
npm run deploy
```

### 4. Verify

Open the Screeps client, go to the **Script** tab, and confirm your code is there. If your spawn is placed, it will start running on the next tick.

## Deploying Code from Git

### Option 1: Manual deploy

Run the deploy command whenever you want to push your latest code to the game:

```bash
git pull
npm run deploy
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

      - run: npm run deploy
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
    username: your_username
    password: your_password
    branch: default
  private:
    host: ${{ secrets.SCREEPS_HOST }}
    port: 21025
    http: true
    username: your_username
    password: your_password
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
npm run deploy -- --server local
```

Your code will run on the local server. Once satisfied, deploy to the shared server:

```bash
npm run deploy -- --server private
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

Go to `http://<server-address>:21025/authmod/password/` in your browser and fill in the form.

Alternatively, ask the server admin to reset it for you.

## Notes

- This is a private server — the in-game tutorial and official shard content do not apply
- If you can see the map but clicking does nothing, the simulation may be paused — let the admin know
