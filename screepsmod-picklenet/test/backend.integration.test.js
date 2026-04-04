// Created with Claude Code (claude.ai/code)
'use strict';

// Integration tests for screepsmod-picklenet HTTP endpoints.
// Require a running local server at localhost:21025.
// Tests are automatically skipped when the server is not reachable.
//
// Run from repo root:
//   make test-picklenet
// or directly:
//   node --test test/backend.integration.test.js

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const HOST = process.env.TEST_HOST || 'localhost';
const PORT = process.env.TEST_PORT || '21025';
const BASE = `http://${HOST}:${PORT}`;

async function fetchJSON(path) {
    const res = await fetch(`${BASE}${path}`);
    return res.json();
}

async function serverReachable() {
    try {
        await fetch(`${BASE}/api/game/time`, { signal: AbortSignal.timeout(2000) });
        return true;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// GET /api/picklenet/map-stats
// ---------------------------------------------------------------------------

describe('GET /api/picklenet/map-stats', async () => {
    let reachable = false;

    before(async () => {
        reachable = await serverReachable();
    });

    it('returns ok=1', async (t) => {
        if (!reachable) return t.skip('server not reachable');
        const data = await fetchJSON('/api/picklenet/map-stats');
        assert.equal(data.ok, 1);
    });

    it('has stats and positive gameTime', async (t) => {
        if (!reachable) return t.skip('server not reachable');
        const data = await fetchJSON('/api/picklenet/map-stats');
        assert.ok('stats' in data);
        assert.ok('gameTime' in data);
        assert.ok(typeof data.stats === 'object');
        assert.ok(data.gameTime > 0);
    });

    it('all rooms have a status field', async (t) => {
        if (!reachable) return t.skip('server not reachable');
        const data = await fetchJSON('/api/picklenet/map-stats');
        for (const [roomId, roomStats] of Object.entries(data.stats)) {
            assert.ok('status' in roomStats, `room ${roomId} missing status`);
        }
    });

    it('at least one room has minerals', async (t) => {
        if (!reachable) return t.skip('server not reachable');
        const data = await fetchJSON('/api/picklenet/map-stats');
        const withMinerals = Object.values(data.stats).filter(r => 'minerals0' in r);
        assert.ok(withMinerals.length > 0, 'expected at least one room with minerals');
    });

    it('has a users dict', async (t) => {
        if (!reachable) return t.skip('server not reachable');
        const data = await fetchJSON('/api/picklenet/map-stats');
        assert.ok('users' in data);
        assert.ok(typeof data.users === 'object');
    });
});

// Created with Claude Code (claude.ai/code)
