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
import shutil
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
                    "http": True,
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
# screeps_map_stats
# ---------------------------------------------------------------------------

class TestMapStatsIntegration(IntegrationTestCase):

    def test_returns_all_rooms(self):
        parsed = json.loads(server.screeps_map_stats(SERVER_NAME, self.player_dir))
        self.assertIn("ok", parsed)
        self.assertIn("stats", parsed)
        self.assertIn("gameTime", parsed)
        self.assertGreater(len(parsed["stats"]), 0)

    def test_room_entries_have_expected_fields(self):
        parsed = json.loads(server.screeps_map_stats(SERVER_NAME, self.player_dir))
        for room_id, room_stats in parsed["stats"].items():
            self.assertIn("status", room_stats, f"room {room_id} missing status")

    def test_minerals_present_for_some_rooms(self):
        parsed = json.loads(server.screeps_map_stats(SERVER_NAME, self.player_dir))
        rooms_with_minerals = [k for k, v in parsed["stats"].items() if "minerals0" in v]
        self.assertGreater(len(rooms_with_minerals), 0, "Expected at least one room with minerals")


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
# screeps_set_tick  (local-only, stateless — restores default in tearDown)
# ---------------------------------------------------------------------------

DEFAULT_TICK_MS = 1000

class TestSetTickIntegration(IntegrationTestCase):

    def tearDown(self):
        server.screeps_set_tick(SERVER_NAME, DEFAULT_TICK_MS, self.player_dir)
        super().tearDown()

    def test_set_tick_returns_no_error(self):
        result = server.screeps_set_tick(SERVER_NAME, 500, self.player_dir)
        self.assertNotIn("Error", result)

    def test_set_tick_restores_default(self):
        server.screeps_set_tick(SERVER_NAME, 500, self.player_dir)
        result = server.screeps_set_tick(SERVER_NAME, DEFAULT_TICK_MS, self.player_dir)
        self.assertNotIn("Error", result)


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

        result = server.screeps_recording_start(SERVER_NAME, self.player_dir)
        self.assertIn("Recording started", result)
        self.assertTrue(pid_file.exists())

        # Wait for the worker to connect, then send a console expression so the
        # next tick produces output that flows through the live console-stream.
        time.sleep(1)
        server.screeps_console(SERVER_NAME, self.player_dir, "console.log('recording-test')")

        # Wait for tick to run and message to arrive
        time.sleep(3)
        self.assertTrue(data_dir.exists())

        # output.log — worker startup line should be present
        output_log = data_dir / "output.log"
        self.assertTrue(output_log.exists())
        self.assertIn("[record-worker]", output_log.read_text())

        # console.jsonl — file must exist; content is only present if testuser has
        # an active spawn and code running. Validate shape of any lines that are present.
        console_log = data_dir / "console.jsonl"
        self.assertTrue(console_log.exists())
        for line in console_log.read_text().splitlines():
            if not line.strip():
                continue
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


# ---------------------------------------------------------------------------
# Base class for tests that need a temporary headless user
# Creates the user before each test; deletes it in tearDown.
# ---------------------------------------------------------------------------

TMP_USER = "inttest_tmp"
TMP_PASS = "inttest_tmppass"


class TmpUserTestCase(IntegrationTestCase):

    def setUp(self):
        super().setUp()
        (Path(self.player_dir) / ".screeps.yml").write_text(yaml.dump({
            "servers": {
                SERVER_NAME: {
                    "host": HOST,
                    "port": PORT,
                    "http": True,
                    "username": TMP_USER,
                    "password": TMP_PASS,
                    "server_type": "local",
                    "server_repo": SERVER_REPO,
                    "user_type": "headless",
                }
            }
        }))
        server.run_make("headless-user", SERVER_REPO, USER=TMP_USER, PASS=TMP_PASS)

    def tearDown(self):
        server.run_make("deleteuser", SERVER_REPO, USER=TMP_USER)
        super().tearDown()


# ---------------------------------------------------------------------------
# screeps_create_headless_user
# ---------------------------------------------------------------------------

class TestCreateHeadlessUserIntegration(IntegrationTestCase):

    def tearDown(self):
        server.run_make("deleteuser", SERVER_REPO, USER=TMP_USER)
        super().tearDown()

    def test_creates_user_successfully(self):
        result = server.screeps_create_headless_user(
            SERVER_NAME, self.player_dir, user=TMP_USER, password=TMP_PASS
        )
        self.assertNotIn("Error", result)

    def test_user_exists_after_creation(self):
        server.screeps_create_headless_user(
            SERVER_NAME, self.player_dir, user=TMP_USER, password=TMP_PASS
        )
        check = server.run_make("check-user", SERVER_REPO, USER=TMP_USER)
        self.assertIn("USER_EXISTS", check)

    def test_idempotent_on_existing_user(self):
        server.screeps_create_headless_user(
            SERVER_NAME, self.player_dir, user=TMP_USER, password=TMP_PASS
        )
        result = server.screeps_create_headless_user(
            SERVER_NAME, self.player_dir, user=TMP_USER, password=TMP_PASS
        )
        self.assertNotIn("Error", result)


# ---------------------------------------------------------------------------
# screeps_set_user_password  (depends on user existing)
# ---------------------------------------------------------------------------

class TestSetUserPasswordIntegration(TmpUserTestCase):

    def test_set_password_returns_no_error(self):
        result = server.screeps_set_user_password(
            SERVER_NAME, self.player_dir, user=TMP_USER, password="newpass123"
        )
        self.assertNotIn("Error", result)

    def test_reads_creds_from_screeps_yml(self):
        # player_dir fixture has TMP_USER/TMP_PASS — omit explicit args
        result = server.screeps_set_user_password(SERVER_NAME, self.player_dir)
        self.assertNotIn("Error", result)


# ---------------------------------------------------------------------------
# screeps_respawn  (depends on user existing)
# ---------------------------------------------------------------------------

class TestRespawnIntegration(TmpUserTestCase):

    def test_respawn_returns_no_error(self):
        result = server.screeps_respawn(
            SERVER_NAME, self.player_dir, user=TMP_USER
        )
        self.assertNotIn("Error", result)

    def test_respawn_reads_user_from_screeps_yml(self):
        result = server.screeps_respawn(SERVER_NAME, self.player_dir)
        self.assertNotIn("Error", result)


# ---------------------------------------------------------------------------
# screeps_deploy  (depends on user existing + spawn placed + kit files present)
# ---------------------------------------------------------------------------

KIT_DIR = Path(SERVER_REPO) / "player_starter_pack"


class TestDeployIntegration(TmpUserTestCase):

    def setUp(self):
        super().setUp()  # creates tmp user, writes .screeps.yml
        # Copy the kit files and bot code into player_dir
        shutil.copy(KIT_DIR / "Makefile", Path(self.player_dir) / "Makefile")
        shutil.copy(KIT_DIR / "Makefile.kit", Path(self.player_dir) / "Makefile.kit")
        (Path(self.player_dir) / "default").mkdir()
        shutil.copy(KIT_DIR / "default" / "main.js", Path(self.player_dir) / "default" / "main.js")
        # Place a spawn so the deployed code has something to run against
        server.screeps_respawn(SERVER_NAME, self.player_dir, user=TMP_USER)

    def test_deploy_uploads_code(self):
        result = server.screeps_deploy(SERVER_NAME, self.player_dir)
        self.assertNotIn("Error", result)

    def test_deploy_uploads_to_correct_branch(self):
        result = server.screeps_deploy(SERVER_NAME, self.player_dir)
        # screeps-api upload prints the branch name on success
        self.assertIn("default", result)


# ---------------------------------------------------------------------------
# screeps_fresh_start  (DESTRUCTIVE — full world wipe, must run last)
# ---------------------------------------------------------------------------

class TestFreshStartIntegration(IntegrationTestCase):

    def test_fresh_start_wipes_and_reimports(self):
        result = server.screeps_fresh_start(SERVER_NAME, self.player_dir)
        self.assertNotIn("Error", result)
        self.assertIn("init-map", result)
        self.assertIn("set-tick-rate", result)
        self.assertIn("user setup", result)

    def test_server_reachable_after_fresh_start(self):
        server.screeps_fresh_start(SERVER_NAME, self.player_dir)
        tick = server.get_game_time(HOST, PORT)
        self.assertGreater(tick, 0)

    def test_map_imported_after_fresh_start(self):
        server.screeps_fresh_start(SERVER_NAME, self.player_dir)
        import urllib.request
        url = f"http://{HOST}:{PORT}/api/picklenet/map-stats"
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        self.assertGreater(len(data.get("stats", {})), 0)


if __name__ == "__main__":
    unittest.main()
# Created with Claude Code (claude.ai/code)
