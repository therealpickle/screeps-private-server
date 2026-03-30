> **Personal project.** This is my own private Screeps server setup. No guarantees, no support, no promises. Use it as a reference if it's useful to you.
>
> Heavily assisted by [Claude](https://claude.ai).

# Screeps Private Server

**New player?** See the [Player Setup Guide](player_starter_pack/README.md).

## Installation

Setup using the [Jomik screeps-server](https://github.com/Jomik/screeps-server) Docker image.

### 1. Install Docker

```bash
sudo apt install -y docker.io
sudo systemctl enable docker
sudo usermod -aG docker $USER
```

Log out and back in for the group change to take effect.

### 2. Download config files

```bash
curl --remote-name-all https://raw.githubusercontent.com/Jomik/screeps-server/main/{docker-compose.yml,.env.sample,config.yml} \
  && cp .env.sample .env
```

### 3. Configure `.env`

Edit `.env` and set the following variables:

| Variable | Required | Description |
|---|---|---|
| `STEAM_KEY` | Yes | Steam API key from https://steamcommunity.com/dev/apikey |
| `SERVER_PASSWORD` | No | If set, players must enter this when connecting via the Steam client |

### 4. Configure mods

Edit `config.yml` and set the mods list:

```yaml
mods:
  - screepsmod-auth
  - screepsmod-admin-utils
  - screepsmod-mongo
  - screepsmod-tickrate
  - screepsmod-features
```

### 5. Start the server

```bash
docker compose up -d
```

### 6. Set a password

```bash
docker compose exec screeps cli
```

Then in the CLI:

```javascript
setPassword("username", "password")
```

## Makefile Reference

| Command | Description |
|---|---|
| `make start` | Start the server |
| `make stop` | Stop the server |
| `make restart` | Restart the server |
| `make rebuild` | Pull latest images and restart |
| `make logs` | Tail server logs |
| `make cli` | Open the server CLI |
| `make reload` | Reload config.yml without restarting |
| `make set-user-pass USER=x PASS=y` | Set a user's password |
| `make staging-user USER=x PASS=y` | Create a user without Steam (staging/testing) |
| `make deleteuser USER=x` | Delete a user |

## Usage

- Server runs at `http://localhost:21025`
- Auto-starts on reboot via Docker
- View logs: `docker compose logs screeps -f`
- Stop: `docker compose stop`
- Full teardown: `docker compose down -v`

## User Management

Registration is disabled. Users are created automatically when they first log in via the Steam client. Set their password via:

```bash
make set-user-pass USER=username PASS=password
```

Share credentials with the user privately. They can change their password at `http://<server>:21025/authmod/password/`.
