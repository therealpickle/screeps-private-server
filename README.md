> **Personal project.** This is my own private Screeps server setup. No guarantees, no support, no promises. Use it as a reference if it's useful to you.
>
> Heavily assisted by [Claude](https://claude.ai).

# Screeps Private Server

**New player?** See the [Player Setup Guide](PLAYER_SETUP.md).

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

### 3. Add Steam API key

Edit `.env` and set your Steam API key (get one at https://steamcommunity.com/dev/apikey):

```
STEAM_KEY=your_key_here
```

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
| `make adduser USER=x PASS=y` | Add a new user |

## Usage

- Server runs at `http://localhost:21025`
- Auto-starts on reboot via Docker
- View logs: `docker compose logs screeps -f`
- Stop: `docker compose stop`
- Full teardown: `docker compose down -v`

## User Management

Registration is disabled by default. Add users manually:

```bash
make adduser USER=username PASS=password
```

Share credentials with the user privately. They can change their password after logging in.
