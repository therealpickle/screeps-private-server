#!/usr/bin/env python3
# Created with Claude Code (claude.ai/code)
"""
Screeps private server MCP — exposes server management as Claude tools.

Entry points:
  python3 server.py                         MCP stdio server (spawned by Claude Code)
  python3 server.py --record start <server> Start recording server's SSE stream (detached)
  python3 server.py --record stop <server>  Stop an active recording
  python3 server.py --record wipe <server>  Delete recorded data
  python3 server.py --record-worker <server> Internal: SSE capture worker (do not call directly)
"""

from __future__ import annotations

import json
import os
import signal
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import yaml
from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

mcp = FastMCP("screeps")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def run_make(target: str, cwd: str | Path, **make_vars) -> str:
    """Run a make target with optional variable overrides. Returns combined stdout+stderr."""
    cmd = ["make", target] + [f"{k}={v}" for k, v in make_vars.items()]
    try:
        result = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
        output = (result.stdout + result.stderr).strip()
        if result.returncode != 0:
            return f"Error (exit {result.returncode}):\n{output}"
        return output or "(no output)"
    except Exception as e:
        return f"Error running make {target}: {e}"


def get_server_repo(cfg: dict) -> Path:
    """Return the local server repo path from the server config."""
    repo = cfg.get("server_repo")
    if not repo:
        raise ValueError(
            "server_repo is not set in .screeps.yml for this server. "
            "Add server_repo: /path/to/screeps-private-server under the server entry."
        )
    return Path(repo)


def local_only(server: str, player_dir: str | Path) -> str | None:
    """Return error string if server is not server_type: local in .screeps.yml."""
    try:
        cfg = get_server_config(server, player_dir)
    except ValueError as e:
        return f"Error: {e}"
    if cfg.get("server_type", "remote") != "local":
        return (
            f"Error: server '{server}' is not a local server "
            f"(server_type: {cfg.get('server_type', 'remote')}). "
            f"Set server_type: local in .screeps.yml to enable server management."
        )
    return None


def parse_screeps_yml(player_dir: str | Path) -> dict:
    """Parse .screeps.yml in player_dir and return the servers dict."""
    path = Path(player_dir) / ".screeps.yml"
    with open(path) as f:
        data = yaml.safe_load(f)
    return data.get("servers", {})


def get_server_config(server: str, player_dir: str | Path) -> dict:
    """Look up host/port/username/password for a server from .screeps.yml."""
    servers = parse_screeps_yml(player_dir)
    cfg = servers.get(server)
    if not cfg:
        raise ValueError(f"Server '{server}' not found in {player_dir}/.screeps.yml")
    return cfg


def auth(host: str, port: int, username: str, password: str) -> str:
    """Authenticate against the server and return an auth token."""
    url = f"http://{host}:{port}/api/auth/signin"
    payload = json.dumps({"email": username, "password": password}).encode()
    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    token = data.get("token")
    if not token:
        raise ValueError(f"Auth failed: {data}")
    return token


def get_game_time(host: str, port: int) -> int:
    """Return the current game tick (no auth required)."""
    url = f"http://{host}:{port}/api/game/time?shard=shard0"
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read())
    return data.get("time", -1)


def discover_owned_rooms(cfg: dict) -> list[str]:
    """Query map-stats and return room IDs owned by the configured user. Returns [] on any error."""
    try:
        host = cfg["host"]
        port = int(cfg.get("port", 21025))
        username = cfg.get("username", "")
        url = f"http://{host}:{port}/api/picklenet/map-stats"
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        user_id = next(
            (uid for uid, u in data.get("users", {}).items()
             if u.get("username", "").lower() == username.lower()),
            None,
        )
        if not user_id:
            return []
        return [
            room_id for room_id, stats in data.get("stats", {}).items()
            if stats.get("owner0", {}).get("user") == user_id
        ]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# User setup helper
# ---------------------------------------------------------------------------

def _ensure_user_spawned(
    cfg: dict,
    user_override: str | None = None,
) -> str:
    """
    Create the user if needed (based on user_type) and place their spawn.
    Called by screeps_fresh_start and screeps_respawn. Returns a status string.
    """
    server_repo = get_server_repo(cfg)
    username = user_override or cfg["username"]
    password = cfg.get("password", "")
    user_type = cfg.get("user_type", "steam")

    result = run_make("check-user", server_repo, USER=username)
    user_exists = "USER_EXISTS" in result

    if not user_exists:
        if user_type == "headless":
            lines = [f"Creating headless user '{username}'..."]
            lines.append(run_make("headless-user", server_repo, USER=username, PASS=password))
        else:  # steam
            host = cfg["host"]
            port = int(cfg.get("port", 21025))
            return (
                f"NEEDS_STEAM_LOGIN: User '{username}' not found. "
                f"Tell the user to log in via the Screeps Steam client at http://{host}:{port} "
                f"using the username '{username}' (set in .screeps.yml), "
                f"then immediately call screeps_await_steam_user (do not wait for confirmation — "
                f"it will poll while they log in)."
            )
    else:
        lines = []

    lines.append(f"Placing spawn for '{username}'...")
    lines.append(run_make("spawn-user", server_repo, USER=username))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# MCP Tools
# ---------------------------------------------------------------------------

# TODO: add tools for API calls currently done via curl in the game-state skill:
#   - screeps_room_terrain(server, player_dir, room) — GET /api/game/room-terrain
#   - screeps_memory_read(server, player_dir, path?) — GET /api/user/memory
#   - screeps_memory_write(server, player_dir, path, value) — POST /api/user/memory
#   - screeps_memory_segment_read(server, player_dir, segment) — GET /api/user/memory-segment

@mcp.tool()
def screeps_server_start(server: str, player_dir: str) -> str:
    """Start the Screeps server (local only). Runs docker compose up."""
    if err := local_only(server, player_dir):
        return err
    cfg = get_server_config(server, player_dir)
    return run_make("start", get_server_repo(cfg))


@mcp.tool()
def screeps_server_stop(server: str, player_dir: str) -> str:
    """Stop the Screeps server (local only). Runs docker compose stop."""
    if err := local_only(server, player_dir):
        return err
    cfg = get_server_config(server, player_dir)
    return run_make("stop", get_server_repo(cfg))


@mcp.tool()
def screeps_server_status(server: str, player_dir: str) -> str:
    """
    Get server status. For local servers, returns container info from docker compose.
    For all servers, fetches the current game tick via HTTP.
    player_dir is optional; when omitted for local, defaults to localhost:21025.
    """
    lines = []

    if player_dir:
        try:
            cfg = get_server_config(server, player_dir)
            if cfg.get("server_type") == "local":
                server_repo = get_server_repo(cfg)
                result = subprocess.run(
                    ["docker", "compose", "ps"],
                    cwd=str(server_repo),
                    capture_output=True,
                    text=True,
                )
                lines.append("=== Containers ===")
                lines.append(result.stdout.strip() or "(no containers running)")
        except Exception:
            pass

    try:
        cfg = get_server_config(server, player_dir)
        host = cfg["host"]
        port = int(cfg.get("port", 21025))
        tick = get_game_time(host, port)
        lines.append(f"\n=== Game ===\nTick: {tick}")
    except Exception as e:
        lines.append(f"\nGame time error: {e}")

    return "\n".join(lines)


@mcp.tool()
def screeps_fresh_start(server: str, player_dir: str, map_key: str = "random_1x1", tick_rate: int = 1000) -> str:
    """
    Reset the game world and import a fresh map (local only).
    Reads user_type from .screeps.yml to determine wipe strategy:
      - user_type: headless -> full database wipe, then creates user and places spawn automatically
      - user_type: steam    -> soft wipe (preserves user accounts), then places spawn automatically
    map_key: map identifier passed to utils.importMap (e.g. random_1x1, random_2x2).
    tick_rate: tick duration in milliseconds.
    """
    if err := local_only(server, player_dir):
        return err

    cfg = get_server_config(server, player_dir)
    server_repo = get_server_repo(cfg)
    user_type = cfg.get("user_type", "steam")

    lines = []
    if user_type == "headless":
        lines.append("--- init-map (full wipe) ---")
        lines.append(run_make("init-map", server_repo, INIT_MAP_KEY=map_key))
    else:
        lines.append("--- soft-wipe (keeping user accounts) ---")
        lines.append(run_make("soft-wipe", server_repo, INIT_MAP_KEY=map_key))

    lines.append("--- set-tick-rate ---")
    lines.append(run_make("set-tick-rate", server_repo, MS=tick_rate))

    lines.append("--- user setup ---")
    lines.append(_ensure_user_spawned(cfg))

    return "\n".join(lines)


@mcp.tool()
def screeps_set_tick(server: str, ms: int, player_dir: str) -> str:
    """Set the tick duration in milliseconds (local only). Not persistent across restarts."""
    if err := local_only(server, player_dir):
        return err
    cfg = get_server_config(server, player_dir)
    return run_make("set-tick-rate", get_server_repo(cfg), MS=ms)


@mcp.tool()
def screeps_simulation_pause(server: str, player_dir: str) -> str:
    """Pause the game simulation (local only)."""
    if err := local_only(server, player_dir):
        return err
    cfg = get_server_config(server, player_dir)
    return run_make("pause", get_server_repo(cfg))


@mcp.tool()
def screeps_simulation_resume(server: str, player_dir: str) -> str:
    """Resume the game simulation (local only)."""
    if err := local_only(server, player_dir):
        return err
    cfg = get_server_config(server, player_dir)
    return run_make("resume", get_server_repo(cfg))


@mcp.tool()
def screeps_deploy(server: str, player_dir: str) -> str:
    """
    Deploy bot code to a server using screeps-api.
    Runs make deploy-<server> from the player's bot repo directory.
    """
    return run_make(f"deploy-{server}", player_dir)


@mcp.tool()
def screeps_respawn(server: str, player_dir: str, user: str = "") -> str:
    """
    Respawn the server user in a new random room (local only). Works like the in-game respawn:
    clears all owned structures/creeps and controller ownership, then places a new Spawn1
    in a random unowned room. Reads username from .screeps.yml if user not specified.
    """
    if err := local_only(server, player_dir):
        return err
    cfg = get_server_config(server, player_dir)
    server_repo = get_server_repo(cfg)
    username = user or cfg["username"]
    return run_make("respawn-user", server_repo, USER=username)


@mcp.tool()
def screeps_await_steam_user(server: str, player_dir: str, user: str = "") -> str:
    """
    Wait for a Steam user to log in, then set their password and place their spawn (local only).
    Call this immediately after screeps_fresh_start returns a "log in via Steam client" message —
    do NOT wait for the user to confirm they've logged in first. This tool polls every 10 seconds
    for up to 5 minutes; the user logs in while it's waiting, and setup completes automatically.
    If user is omitted, reads username and password from .screeps.yml.
    """
    if err := local_only(server, player_dir):
        return err
    cfg = get_server_config(server, player_dir)
    server_repo = get_server_repo(cfg)
    username = user or cfg["username"]
    password = cfg.get("password", "")

    timeout, interval, elapsed = 300, 10, 0
    while elapsed < timeout:
        result = run_make("check-user", server_repo, USER=username)
        if "USER_EXISTS" in result:
            break
        time.sleep(interval)
        elapsed += interval
    else:
        return f"Timeout: '{username}' never appeared after {timeout}s. Did you log in via the Steam client?"

    lines = [f"User '{username}' detected after {elapsed}s."]
    lines.append(f"Setting password for '{username}'...")
    lines.append(run_make("set-user-pass", server_repo, USER=username, PASS=password))
    lines.append(f"Placing spawn for '{username}'...")
    lines.append(run_make("spawn-user", server_repo, USER=username))
    return "\n".join(lines)


@mcp.tool()
def screeps_create_headless_user(server: str, player_dir: str, user: str = "", password: str = "") -> str:
    """
    Manually create a non-Steam (headless) user with password auth (local only).
    If user/password are omitted, reads them from .screeps.yml.
    Idempotent — safe to call if the user already exists.
    After creating, call screeps_respawn to place their spawn.
    """
    if err := local_only(server, player_dir):
        return err
    cfg = get_server_config(server, player_dir)
    return run_make(
        "headless-user", get_server_repo(cfg),
        USER=user or cfg["username"],
        PASS=password or cfg.get("password", ""),
    )


@mcp.tool()
def screeps_set_user_password(server: str, player_dir: str, user: str = "", password: str = "") -> str:
    """
    Set or reset a user's password (local only).
    If user/password are omitted, reads them from .screeps.yml.
    Useful for giving a Steam user password-based API access after their first Steam login.
    For headless users, use screeps_create_headless_user instead (sets password at creation).
    """
    if err := local_only(server, player_dir):
        return err
    cfg = get_server_config(server, player_dir)
    return run_make(
        "set-user-pass", get_server_repo(cfg),
        USER=user or cfg["username"],
        PASS=password or cfg.get("password", ""),
    )


@mcp.tool()
def screeps_console(server: str, player_dir: str, expr: str) -> str:
    """
    Execute a JavaScript expression in the game sandbox.
    Output is asynchronous — it appears in the console stream, not in the return value.
    """
    try:
        cfg = get_server_config(server, player_dir)
        host = cfg["host"]
        port = int(cfg.get("port", 21025))
        username = cfg["username"]
        password = cfg["password"]
        token = auth(host, port, username, cfg.get("password", ""))

        url = f"http://{host}:{port}/api/user/console"
        payload = json.dumps({"expression": expr}).encode()
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "X-Token": token,
                "X-Username": username,
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        return f"Sent. Server response: {json.dumps(data)}\n(Output is asynchronous — check console stream)"
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def screeps_map_stats(server: str, player_dir: str) -> str:
    """
    Get map stats for all rooms in the world via the picklenet API.
    Returns the same shape as /api/game/map-stats but covers every room.
    Each room entry includes: status, minerals0 (if present), owner0 (if claimed).
    users dict is populated with owner info when any room is owned.
    No authentication required.
    """
    try:
        cfg = get_server_config(server, player_dir)
        host = cfg["host"]
        port = int(cfg.get("port", 21025))
        url = f"http://{host}:{port}/api/picklenet/map-stats"
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        return json.dumps(data, indent=2)
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def screeps_room_objects(server: str, player_dir: str, room: str) -> str:
    """
    Get all game objects in a room (creeps, structures, sources, minerals, etc.).
    No authentication required. Returns JSON with an 'objects' array.
    Each object has: type, x, y, user (owner id), body (creeps), store (resources).
    """
    try:
        cfg = get_server_config(server, player_dir)
        host = cfg["host"]
        port = int(cfg.get("port", 21025))
        url = f"http://{host}:{port}/api/game/room-objects?room={room}&shard=shard0"
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        return json.dumps(data, indent=2)
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def screeps_recording_start(server: str, player_dir: str, rooms: list[str] | None = None,
                            max_size: int = 0) -> str:
    """
    Start recording game state from a server's SSE stream to player_dir/recording-<server>/.
    Spawns a detached background process that persists after this session ends.
    rooms: list of room IDs to subscribe to (e.g. ["W1N1", "W2N2"]).
           When omitted, owned rooms are auto-discovered from the map-stats API.
           Pass [] explicitly to record console output only (no room frames).
    max_size: total size limit in bytes across all log files for this server (0 = unlimited).
           Each individual log file rotates at max_size//20 bytes; oldest segments are deleted
           to stay within max_size total.
    """
    try:
        if rooms is None:
            cfg = get_server_config(server, player_dir)
            rooms = discover_owned_rooms(cfg)
        _record_start(server, player_dir, rooms, max_size)
        rooms_str = ", ".join(rooms) if rooms else "(none — console only)"
        return f"Recording started for '{server}'. Rooms: {rooms_str}. Data: {player_dir}/recording-{server}/"
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def screeps_recording_stop(server: str, player_dir: str) -> str:
    """Stop an active recording for a server."""
    try:
        _record_stop(server, player_dir)
        return f"Recording stopped for '{server}'"
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def screeps_recording_wipe(server: str, player_dir: str) -> str:
    """Delete all recorded data for a server. Fails if a recording is currently active."""
    try:
        _record_wipe(server, player_dir)
        return f"Recording data wiped for '{server}'"
    except Exception as e:
        return f"Error: {e}"


# ---------------------------------------------------------------------------
# Recording implementation
# ---------------------------------------------------------------------------

def _pid_file(server: str, player_dir: str | Path) -> Path:
    return Path(player_dir) / f".recording-{server}.pid"


def _data_dir(server: str, player_dir: str | Path) -> Path:
    return Path(player_dir) / f"recording-{server}"


def _rotate_log(path: Path, max_total: int) -> None:
    """Rotate path: rename to a numbered segment, create a fresh active file, then prune
    the oldest segments until total size (segments + active file) is within max_total bytes."""
    parent, stem, suffix = path.parent, path.stem, path.suffix
    existing = sorted(parent.glob(f"{stem}.*[0-9]{suffix}"))
    try:
        counter = int(existing[-1].stem.rsplit(".", 1)[-1]) + 1 if existing else 1
    except (ValueError, IndexError):
        counter = len(existing) + 1
    path.rename(parent / f"{stem}.{counter:04d}{suffix}")
    path.touch()
    if max_total > 0:
        while True:
            segments = sorted(parent.glob(f"{stem}.*[0-9]{suffix}"))
            total = sum(f.stat().st_size for f in segments) + path.stat().st_size
            if total <= max_total or not segments:
                break
            segments[0].unlink()


def _record_start(server: str, player_dir: str | Path, rooms: list[str], max_size: int = 0) -> None:
    """Spawn a detached recording worker and write its PID."""
    pid_file = _pid_file(server, player_dir)
    if pid_file.exists():
        pid = pid_file.read_text().strip()
        if pid:
            raise RuntimeError(f"Already recording '{server}' (pid {pid}). Stop it first.")

    _data_dir(server, player_dir).mkdir(parents=True, exist_ok=True)
    log_path = _data_dir(server, player_dir) / "output.log"

    with open(log_path, "a") as log:
        cmd = [sys.executable, str(Path(__file__).resolve()), "--record-worker", server]
        if max_size:
            cmd += ["--max-size", str(max_size)]
        cmd += rooms
        proc = subprocess.Popen(
            cmd,
            cwd=str(player_dir),
            stdout=log,
            stderr=log,
            start_new_session=True,
        )

    pid_file.write_text(str(proc.pid))


def _record_stop(server: str, player_dir: str | Path) -> None:
    """Kill the recording worker via its PID file."""
    pid_file = _pid_file(server, player_dir)
    if not pid_file.exists():
        raise RuntimeError(f"No active recording found for '{server}'")

    pid = int(pid_file.read_text().strip())
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass  # Process already exited
    pid_file.unlink()


def _record_wipe(server: str, player_dir: str | Path) -> None:
    """Delete the recording data directory. Fails if recording is active."""
    pid_file = _pid_file(server, player_dir)
    if pid_file.exists():
        raise RuntimeError(f"Recording is active for '{server}'. Stop it first.")

    data_dir = _data_dir(server, player_dir)
    if data_dir.exists():
        shutil.rmtree(data_dir)
    else:
        raise RuntimeError(f"No recording data found for '{server}'")


def _stream_to_file(label: str, url: str, token: str, out_file: Path, max_size: int = 0) -> None:
    """Subscribe to an SSE endpoint and append data frames to out_file. Runs until exception."""
    file_limit = max_size // 20 if max_size > 0 else 0
    req = urllib.request.Request(url, headers={"X-Token": token})
    with urllib.request.urlopen(req, timeout=90) as resp:
        f = open(out_file, "a", encoding="utf-8")
        try:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                f.write(line[5:].strip() + "\n")
                f.flush()
                if file_limit > 0 and out_file.stat().st_size >= file_limit:
                    f.close()
                    _rotate_log(out_file, max_size)
                    f = open(out_file, "a", encoding="utf-8")
        finally:
            f.close()


def _record_stream_loop(label: str, url_fn, out_file: Path,
                        host: str, port: int, username: str, password: str,
                        max_size: int = 0) -> None:
    """Retry loop for a single SSE stream. Reauthenticates on each reconnect."""
    while True:
        try:
            token = auth(host, port, username, password)
            _stream_to_file(label, url_fn(host, port, token), token, out_file, max_size)
        except Exception as e:
            print(f"[record-worker:{label}] Error: {e}, retrying in 5s...", flush=True)
            time.sleep(5)


def _record_worker(server: str, rooms: list[str], max_size: int = 0) -> None:
    """
    Recording worker: subscribes to picklenet console-stream and optionally room-stream SSE.
    Writes to recording-<server>/console.jsonl (always) and frames.jsonl (when rooms given).
    Runs until killed. CWD must be the player's bot repo (contains .screeps.yml).
    """
    import threading

    player_dir = Path.cwd()
    data_dir = _data_dir(server, player_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    cfg = get_server_config(server, player_dir)
    host = cfg["host"]
    port = int(cfg.get("port", 21025))
    username = cfg["username"]
    password = cfg.get("password", "")

    rooms_label = ", ".join(rooms) if rooms else "none"
    print(f"[record-worker] Started for '{server}' -> {data_dir}/ rooms=[{rooms_label}]", flush=True)

    if rooms:
        rooms_param = ",".join(rooms)
        # Room-stream runs in the main thread; console-stream in a daemon thread
        console_thread = threading.Thread(
            target=_record_stream_loop,
            args=(
                "console",
                lambda h, p, t: f"http://{h}:{p}/api/picklenet/console-stream",
                data_dir / "console.jsonl",
                host, port, username, password, max_size,
            ),
            daemon=True,
        )
        console_thread.start()
        _record_stream_loop(
            "rooms",
            lambda h, p, t: f"http://{h}:{p}/api/picklenet/room-stream?rooms={rooms_param}",
            data_dir / "frames.jsonl",
            host, port, username, password, max_size,
        )
    else:
        # Console only — run in main thread so the process stays alive
        _record_stream_loop(
            "console",
            lambda h, p, t: f"http://{h}:{p}/api/picklenet/console-stream",
            data_dir / "console.jsonl",
            host, port, username, password, max_size,
        )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _record_cli(args: list[str]) -> None:
    """Handle --record <start|stop|wipe> <server> (invoked from Makefile, CWD = player dir)."""
    if len(args) < 2:
        print("Usage: server.py --record <start|stop|wipe> <server>", file=sys.stderr)
        sys.exit(1)

    action, server = args[0], args[1]
    player_dir = Path.cwd()

    try:
        if action == "start":
            remaining = args[2:]
            max_size, rooms_raw, i = 0, [], 0
            while i < len(remaining):
                if remaining[i] == "--max-size" and i + 1 < len(remaining):
                    max_size = int(remaining[i + 1]); i += 2
                else:
                    rooms_raw.append(remaining[i]); i += 1
            rooms: list[str] | None = rooms_raw if rooms_raw else None
            if rooms is None:
                try:
                    cfg = get_server_config(server, player_dir)
                    rooms = discover_owned_rooms(cfg)
                except Exception:
                    rooms = []
            _record_start(server, player_dir, rooms, max_size)
            rooms_str = ", ".join(rooms) if rooms else "(none — console only)"
            print(f"Recording started for '{server}'. Rooms: {rooms_str}")
        elif action == "stop":
            _record_stop(server, player_dir)
            print(f"Recording stopped for '{server}'")
        elif action == "wipe":
            _record_wipe(server, player_dir)
            print(f"Recording wiped for '{server}'")
        else:
            print(f"Unknown action '{action}'. Use: start, stop, wipe", file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    args = sys.argv[1:]

    if args and args[0] == "--record":
        _record_cli(args[1:])
    elif args and args[0] == "--record-worker":
        if len(args) < 2:
            print("Usage: server.py --record-worker <server> [--max-size N] [room1 room2 ...]",
                  file=sys.stderr)
            sys.exit(1)
        remaining = args[2:]
        max_size, rooms, i = 0, [], 0
        while i < len(remaining):
            if remaining[i] == "--max-size" and i + 1 < len(remaining):
                max_size = int(remaining[i + 1]); i += 2
            else:
                rooms.append(remaining[i]); i += 1
        _record_worker(args[1], rooms, max_size)
    else:
        mcp.run()

# Created with Claude Code (claude.ai/code)
