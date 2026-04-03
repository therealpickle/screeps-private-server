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

# Default: parent of this file (i.e. the root of screeps-private-server repo)
SERVER_REPO_PATH = Path(os.environ.get("SERVER_REPO_PATH", Path(__file__).parent.parent))

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


def local_only(server: str) -> str | None:
    """Return an error string if server is not 'local', else None."""
    if server != "local":
        return f"Error: this tool only works on the local server (got '{server}')"
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
    if server == "local":
        cfg = servers.get("local") or servers.get("private") or (
            next(iter(servers.values()), None)
        )
    else:
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


# ---------------------------------------------------------------------------
# MCP Tools
# ---------------------------------------------------------------------------

@mcp.tool()
def screeps_server_start(server: str) -> str:
    """Start the Screeps server (local only). Runs docker compose up."""
    if err := local_only(server):
        return err
    return run_make("start", SERVER_REPO_PATH)


@mcp.tool()
def screeps_server_stop(server: str) -> str:
    """Stop the Screeps server (local only). Runs docker compose stop."""
    if err := local_only(server):
        return err
    return run_make("stop", SERVER_REPO_PATH)


@mcp.tool()
def screeps_server_status(server: str, player_dir: str = "") -> str:
    """
    Get server status. For local servers, returns container info from docker compose.
    For all servers, fetches the current game tick via HTTP.
    player_dir is optional; when omitted for local, defaults to localhost:21025.
    """
    lines = []

    if server == "local":
        result = subprocess.run(
            ["docker", "compose", "ps"],
            cwd=str(SERVER_REPO_PATH),
            capture_output=True,
            text=True,
        )
        lines.append("=== Containers ===")
        lines.append(result.stdout.strip() or "(no containers running)")

    try:
        if player_dir:
            cfg = get_server_config(server, player_dir)
            host = cfg["host"]
            port = int(cfg.get("port", 21025))
        elif server == "local":
            host, port = "localhost", 21025
        else:
            return "\n".join(lines) + "\nError: player_dir required to get game time for non-local servers"
        tick = get_game_time(host, port)
        lines.append(f"\n=== Game ===\nTick: {tick}")
    except Exception as e:
        lines.append(f"\nGame time error: {e}")

    return "\n".join(lines)


@mcp.tool()
def screeps_fresh_start(server: str, map_key: str = "random_1x1", tick_rate: int = 1000) -> str:
    """
    Wipe the server database, import a fresh map, and set the tick rate (local only).
    map_key: map identifier passed to utils.importMap (e.g. random_1x1, random_2x2).
    tick_rate: tick duration in milliseconds.
    """
    if err := local_only(server):
        return err
    lines = ["--- init-map ---"]
    lines.append(run_make("init-map", SERVER_REPO_PATH, INIT_MAP_KEY=map_key))
    lines.append("--- set-tick-rate ---")
    lines.append(run_make("set-tick-rate", SERVER_REPO_PATH, MS=tick_rate))
    return "\n".join(lines)


@mcp.tool()
def screeps_set_tick(server: str, ms: int) -> str:
    """Set the tick duration in milliseconds (local only). Not persistent across restarts."""
    if err := local_only(server):
        return err
    return run_make("set-tick-rate", SERVER_REPO_PATH, MS=ms)


@mcp.tool()
def screeps_deploy(server: str, player_dir: str) -> str:
    """
    Deploy bot code to a server using screeps-api.
    Runs make deploy-<server> from the player's bot repo directory.
    """
    return run_make(f"deploy-{server}", player_dir)


@mcp.tool()
def screeps_respawn(server: str, user: str) -> str:
    """
    Spawn a user into a random unowned room (local only).
    The user must already exist. Idempotent — safe to call if the user already has a spawn.
    """
    if err := local_only(server):
        return err
    return run_make("spawn-user", SERVER_REPO_PATH, USER=user)


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
        token = auth(host, port, username, password)

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
def screeps_recording_start(server: str, player_dir: str) -> str:
    """
    Start recording game state from a server's SSE stream to player_dir/recording-<server>/.
    Spawns a detached background process that persists after this session ends.
    """
    try:
        _record_start(server, player_dir)
        return f"Recording started for '{server}'. Data: {player_dir}/recording-{server}/frames.jsonl"
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


def _record_start(server: str, player_dir: str | Path) -> None:
    """Spawn a detached recording worker and write its PID."""
    pid_file = _pid_file(server, player_dir)
    if pid_file.exists():
        pid = pid_file.read_text().strip()
        if pid:
            raise RuntimeError(f"Already recording '{server}' (pid {pid}). Stop it first.")

    _data_dir(server, player_dir).mkdir(parents=True, exist_ok=True)
    log_path = _data_dir(server, player_dir) / "output.log"

    with open(log_path, "a") as log:
        proc = subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), "--record-worker", server],
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


def _record_worker(server: str) -> None:
    """
    Recording worker: subscribes to picklenet room-stream SSE and writes
    each data frame as a JSON line to recording-<server>/frames.jsonl.
    Runs until killed. CWD must be the player's bot repo (contains .screeps.yml).
    """
    player_dir = Path.cwd()
    data_dir = _data_dir(server, player_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    frames_file = data_dir / "frames.jsonl"

    cfg = get_server_config(server, player_dir)
    host = cfg["host"]
    port = int(cfg.get("port", 21025))
    username = cfg["username"]
    password = cfg["password"]

    print(f"[record-worker] Started for '{server}' -> {frames_file}", flush=True)

    while True:
        try:
            token = auth(host, port, username, password)
            url = f"http://{host}:{port}/api/picklenet/room-stream"
            req = urllib.request.Request(url, headers={"X-Token": token})

            with urllib.request.urlopen(req, timeout=90) as resp:
                with open(frames_file, "a") as f:
                    for raw_line in resp:
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if line.startswith("data:"):
                            f.write(line[5:].strip() + "\n")
                            f.flush()
        except Exception as e:
            print(f"[record-worker] Error: {e}, retrying in 5s...", flush=True)
            time.sleep(5)


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
            _record_start(server, player_dir)
            print(f"Recording started for '{server}'")
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
            print("Usage: server.py --record-worker <server>", file=sys.stderr)
            sys.exit(1)
        _record_worker(args[1])
    else:
        mcp.run()

# Created with Claude Code (claude.ai/code)
