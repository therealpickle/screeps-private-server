# Screeps Server - Setup Notes

## What works

Use the [Jomik screeps-server](https://github.com/Jomik/screeps-server) Docker image. This is the only reliable approach on modern Debian/Ubuntu — the official `npm install -g screeps` method requires Python 2 which is no longer available in Debian repos.

## Prerequisites

- Docker installed and running
- User added to the `docker` group
- A Steam API key from https://steamcommunity.com/dev/apikey

## Setup

```bash
curl --remote-name-all https://raw.githubusercontent.com/Jomik/screeps-server/main/{docker-compose.yml,.env.sample,config.yml} \
  && cp .env.sample .env
```

Set Steam key in `.env`:
```
STEAM_KEY=your_key_here
```

Set mods in `config.yml`:
```yaml
mods:
  - screepsmod-auth
  - screepsmod-admin-utils
  - screepsmod-mongo
  - screepsmod-tickrate
  - screepsmod-features
```

Start:
```bash
docker compose up -d
```

## User management

Registration is disabled. Add users via:
```bash
make adduser USER=username PASS=password
```

## First-time startup checklist

After `docker compose up -d` on a fresh server, users won't be able to spawn until you:

1. Import a map: `utils.importMap('random')`
2. Resume the simulation: `system.resumeSimulation()`

If that still doesn't work, initialize the database first: `system.resetAllData()`, then re-import the map and resume.

## CLI output notes

A response of `> >` (undefined) from the CLI is normal — it means the command ran successfully with no return value. This is expected for `setPassword`, `utils.reloadConfig()`, `system.resumeSimulation()`, etc.

## What didn't work

- `npm install -g screeps` — requires Python 2, not available on modern Debian
- `screeps-launcher` binary — downloads its own Node 12 internally, incompatible with Python 3.11+
- Installing Python 2 from apt — package no longer available in Debian repos
- `auth.setPassword(...)` — wrong, the correct call is just `setPassword(...)` with no `auth.` prefix

---

## Server Administration

### CLI access

```bash
make cli
# or:
docker compose exec screeps cli
```

### Core commands

| Command | Description |
|---|---|
| `system.resetAllData()` | Wipe and reinitialize the database |
| `system.resumeSimulation()` | Resume simulation after map import |
| `system.setTickDuration(value)` | Set tick duration in ms |
| `system.getTickDuration()` | Get current tick duration |

### screepsmod-auth

Set a user's password:
```js
setPassword('Username', 'Password')
```

Users can also set their password via the web form at `http://yourserver:21025/authmod/password/`.

New user defaults can be set in `config.yml`:
```yaml
auth:
  cpu: 100
  preventSpawning: false
```

### screepsmod-admin-utils

**Map management:**
```js
utils.importMap('random')          // Random map
utils.importMap('random_2x2')      // Random 2x2 map
utils.importMap(urlOrId)           // Import from URL or maps.screepspl.us ID
utils.importMapFile('/path/file')  // Import from local file
// After import, resume with:
system.resumeSimulation()
```

**NPC terminals:**
```js
utils.addNPCTerminals(10)   // Add NPC terminals every 10 rooms
utils.removeNPCTerminals()  // Remove all NPC terminals
utils.removeBots()          // Remove all bots
```

**CPU management:**
```js
utils.getCPULimit('username')         // Get a user's CPU limit
utils.setCPULimit('username', 100)    // Set a user's CPU limit
utils.enableGCLToCPU(300, 20, 10)    // Scale CPU by GCL (max, base, step)
utils.disableGCLToCPU()              // Disable GCL scaling
```

**Other:**
```js
utils.setSocketUpdateRate(200)  // Set socket update rate (ms)
utils.getSocketUpdateRate()     // Get socket update rate
utils.setShardName('myServer')  // Set shard name
utils.reloadConfig()            // Reload config.yml without restart
```

**config.yml options (screepsmod-admin-utils):**
```yaml
serverConfig:
  tickRate: 200
  socketUpdateRate: 200
  shardName: 'myServer'
  welcomeText: '<html>Welcome!</html>'
  whitelist:             # Restrict spawning to these users only
    - username1
    - username2
  gclToCPU: true
  maxCPU: 300
  baseCPU: 20
  stepCPU: 10
  constants:
    UPGRADE_POWER: 10
```

### screepsmod-mongo

```js
mongo.importDB()        // Import existing LokiJS data into MongoDB
system.resetAllData()   // Initialize a fresh database
```

### screepsmod-features

```js
setFeatureEnabled('feature-name', true)   // Enable a feature
setFeatureEnabled('feature-name', false)  // Disable a feature
```

---

## Quick Reference: All CLI Commands

| Command | Source | Description |
|---|---|---|
| `system.resetAllData()` | core | Wipe and reinitialize the database |
| `system.resumeSimulation()` | core | Resume after map import |
| `system.setTickDuration(value)` | core | Set tick duration in ms |
| `system.getTickDuration()` | core | Get current tick duration |
| `setPassword('User', 'Pass')` | screepsmod-auth | Set a user's password |
| `utils.importMap(urlOrId)` | screepsmod-admin-utils | Import a map |
| `utils.importMapFile(filePath)` | screepsmod-admin-utils | Import map from local file |
| `utils.addNPCTerminals(interval)` | screepsmod-admin-utils | Add NPC terminals |
| `utils.removeNPCTerminals()` | screepsmod-admin-utils | Remove all NPC terminals |
| `utils.removeBots()` | screepsmod-admin-utils | Remove all bots |
| `utils.setSocketUpdateRate(val)` | screepsmod-admin-utils | Set socket update rate (ms) |
| `utils.getSocketUpdateRate()` | screepsmod-admin-utils | Get socket update rate |
| `utils.setShardName(value)` | screepsmod-admin-utils | Set shard name |
| `utils.reloadConfig()` | screepsmod-admin-utils | Reload config.yml |
| `utils.getCPULimit(username)` | screepsmod-admin-utils | Get a user's CPU limit |
| `utils.setCPULimit(username, val)` | screepsmod-admin-utils | Set a user's CPU limit |
| `utils.enableGCLToCPU(max,base,step)` | screepsmod-admin-utils | Enable GCL-based CPU scaling |
| `utils.disableGCLToCPU()` | screepsmod-admin-utils | Disable GCL-based CPU scaling |
| `mongo.importDB()` | screepsmod-mongo | Import LokiJS data into MongoDB |
| `setFeatureEnabled('name', bool)` | screepsmod-features | Toggle a named feature |
