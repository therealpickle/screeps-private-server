# Created with Claude Code (claude.ai/code)
"""Integration tests for mcp/server.py — require a running local server at localhost:21025.

Tests are automatically skipped when the server is not reachable.

Run from repo root:
    make test-mcp
or directly:
    .venv/bin/python -m pytest mcp/test_server_integration.py -v
"""
import json
import os
import sys
import time
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import yaml
import server

# ---------------------------------------------------------------------------
# Configuration — override with env vars if needed
# ---------------------------------------------------------------------------

HOST        = os.environ.get("TEST_HOST", "localhost")
PORT        = int(os.environ.get("TEST_PORT", "21025"))
USERNAME    = os.environ.get("TEST_USER", "testuser")
PASSWORD    = os.environ.get("TEST_PASS", "testpass")
SERVER_NAME = "local"
SERVER_REPO = str(Path(__file__).parent.parent)


def _server_reachable() -> bool:
    try:
        server.get_game_time(HOST, PORT)
        return True
    except Exception:
        return False


_REACHABLE = _server_reachable()
_SKIP_MSG  = f"Server not reachable at {HOST}:{PORT}"


# ---------------------------------------------------------------------------
# Base class — sets up a temp player_dir with .screeps.yml
# ---------------------------------------------------------------------------

class IntegrationTestCase(unittest.TestCase):

    def setUp(self):
        if not _REACHABLE:
            self.skipTest(_SKIP_MSG)
        self._tmpdir = tempfile.TemporaryDirectory()
        self.player_dir = self._tmpdir.name
        screeps_yml = {
            "servers": {
                SERVER_NAME: {
                    "host": HOST,
                    "port": PORT,
                    "username": USERNAME,
                    "password": PASSWORD,
                    "server_type": "local",
                    "server_repo": SERVER_REPO,
                    "user_type": "headless",
                }
            }
        }
        (Path(self.player_dir) / ".screeps.yml").write_text(yaml.dump(screeps_yml))

    def tearDown(self):
        self._tmpdir.cleanup()


# ---------------------------------------------------------------------------
# screeps_server_status
# ---------------------------------------------------------------------------

class TestStatusIntegration(IntegrationTestCase):

    def test_returns_positive_tick(self):
        import re
        result = server.screeps_server_status(SERVER_NAME, self.player_dir)
        self.assertIn("Tick", result)
        match = re.search(r"Tick:\s*(\d+)", result)
        self.assertIsNotNone(match, f"No tick found in: {result}")
        self.assertGreater(int(match.group(1)), 0)

    def test_local_includes_containers(self):
        result = server.screeps_server_status(SERVER_NAME, self.player_dir)
        self.assertIn("Containers", result)


# ---------------------------------------------------------------------------
# screeps_room_objects
# ---------------------------------------------------------------------------

class TestRoomObjectsIntegration(IntegrationTestCase):

    def test_returns_valid_response_shape(self):
        # W1N1 is typical for a random_1x1 map; may be empty but API always returns objects+users
        result = server.screeps_room_objects(SERVER_NAME, self.player_dir, "W1N1")
        parsed = json.loads(result)
        self.assertIn("objects", parsed)
        self.assertIsInstance(parsed["objects"], list)


# ---------------------------------------------------------------------------
# screeps_console
# ---------------------------------------------------------------------------

class TestConsoleIntegration(IntegrationTestCase):

    def test_sends_expression(self):
        result = server.screeps_console(SERVER_NAME, self.player_dir, "1+1")
        self.assertIn("Sent", result)
        self.assertNotIn("Error", result)


# ---------------------------------------------------------------------------
# screeps_recording_start / stop / wipe
# ---------------------------------------------------------------------------

class TestRecordingIntegration(IntegrationTestCase):

    def _cleanup(self):
        pid_file = Path(self.player_dir) / f".recording-{SERVER_NAME}.pid"
        if pid_file.exists():
            server.screeps_recording_stop(SERVER_NAME, self.player_dir)
        data_dir = Path(self.player_dir) / f"recording-{SERVER_NAME}"
        if data_dir.exists():
            server.screeps_recording_wipe(SERVER_NAME, self.player_dir)

    def tearDown(self):
        self._cleanup()
        super().tearDown()

    def test_start_stop_wipe(self):
        pid_file = Path(self.player_dir) / f".recording-{SERVER_NAME}.pid"
        data_dir = Path(self.player_dir) / f"recording-{SERVER_NAME}"

        # Send a console expression so the server has at least one message in its
        # replay history — the console-stream replays the last 200 on connect.
        server.screeps_console(SERVER_NAME, self.player_dir, "1+1")

        result = server.screeps_recording_start(SERVER_NAME, self.player_dir)
        self.assertIn("Recording started", result)
        self.assertTrue(pid_file.exists())

        # Give the worker time to connect and receive the console replay
        time.sleep(3)
        self.assertTrue(data_dir.exists())

        # output.log — worker startup line should be present
        output_log = data_dir / "output.log"
        self.assertTrue(output_log.exists())
        self.assertIn("[record-worker]", output_log.read_text())

        # console.jsonl — should have ≥1 valid JSON line with expected fields
        console_log = data_dir / "console.jsonl"
        self.assertTrue(console_log.exists())
        lines = [l for l in console_log.read_text().splitlines() if l.strip()]
        self.assertGreater(len(lines), 0, "console.jsonl is empty")
        for line in lines:
            entry = json.loads(line)
            self.assertIn("ts", entry)
            self.assertIn("text", entry)
            self.assertIn("type", entry)

        # frames.jsonl — not checked: room-stream needs ?rooms=... params to produce
        # frame data, so the file won't be created without a room subscription tool.

        result = server.screeps_recording_stop(SERVER_NAME, self.player_dir)
        self.assertIn("stopped", result)
        self.assertFalse(pid_file.exists())

        result = server.screeps_recording_wipe(SERVER_NAME, self.player_dir)
        self.assertIn("wiped", result)
        self.assertFalse(data_dir.exists())

    def test_double_start_returns_error(self):
        server.screeps_recording_start(SERVER_NAME, self.player_dir)
        result = server.screeps_recording_start(SERVER_NAME, self.player_dir)
        self.assertIn("Error", result)
        self.assertIn("Already recording", result)


if __name__ == "__main__":
    unittest.main()
# Created with Claude Code (claude.ai/code)
