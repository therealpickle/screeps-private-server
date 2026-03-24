# Player Setup Guide

## Prerequisites

- Screeps purchased on Steam
- Your username and password (get these from the server admin)

## Connecting to the Server

1. Open Screeps via Steam
2. On the login screen, click **Change server** in the bottom-left
3. Enter the server address and click **Connect**:
   ```
   http://<server-address>:21025
   ```
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
npm install
```

### 2. Configure deployment

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

> Don't commit this file — it contains your password. Add it to `.gitignore`.

### 3. Deploy your code

```bash
npm run deploy -- --server private
```

Check your starter's `package.json` for the exact deploy command — the script name may vary.

### 4. Verify

Open the Screeps client, go to the **Script** tab, and confirm your code is there. If your spawn is placed, it will start running on the next tick.

## Changing Your Password

Go to `http://<server-address>:21025/authmod/password/` in your browser and fill in the form.

Alternatively, ask the server admin to reset it for you.

## Notes

- This is a private server — the in-game tutorial and official shard content do not apply
- If you can see the map but clicking does nothing, the simulation may be paused — let the admin know
