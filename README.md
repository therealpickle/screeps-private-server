# Screeps Private Server

Setup using the [Jomik screeps-server](https://github.com/Jomik/screeps-server) Docker image.

## Installation

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
auth.setPassword("username", "password")
```

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
