'use strict';

// Tests for screepsmod-picklenet/lib/backend.js
//
// Runs with Node's built-in test runner (no extra dependencies):
//   node --test test/backend.test.js

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib   = require('node:zlib');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal mock config accepted by setupBackend().
 *
 * opts.tokens  — map of token → userId  (default: { 'tok-a': 'user-a' })
 * opts.memory  — map of userId → raw JSON string  (default: {})
 * opts.objects — array of room objects returned by db.find()  (default: [])
 * opts.scope   — roomStream.scope value  (default: 'any')
 */
function makeConfig(opts = {}) {
    const tokens  = opts.tokens  || { 'tok-a': 'user-a' };
    const memory  = opts.memory  || {};
    const objects = opts.objects || [];
    const scope   = opts.scope   || 'any';

    const pubsubs = {};

    return {
        _pubsubs: pubsubs,

        common: {
            storage: {
                env: {
                    get(key) {
                        if (key.startsWith('auth_'))   return Promise.resolve(tokens[key.slice(5)] ?? null);
                        if (key.startsWith('memory:')) return Promise.resolve(memory[key.slice(7)] ?? null);
                        return Promise.resolve(null);
                    },
                },
                db: {
                    'rooms.objects': {
                        find(query) {
                            const andFilter = query && query.$and;
                            if (andFilter) {
                                const roomFilter = andFilter.find(c => c.room && c.room.$in);
                                const typeFilter = andFilter.find(c => c.type);
                                const roomList = roomFilter ? roomFilter.room.$in : null;
                                return Promise.resolve(objects.filter(o => {
                                    if (typeFilter && o.type !== typeFilter.type) return false;
                                    if (roomList && !roomList.includes(o.room)) return false;
                                    return true;
                                }));
                            }
                            const rooms = query && query.room && query.room.$in;
                            if (rooms) {
                                return Promise.resolve(objects.filter(o => rooms.includes(o.room)));
                            }
                            return Promise.resolve(objects);
                        },
                    },
                },
                pubsub: {
                    subscribe(channel, cb) {
                        if (!pubsubs[channel]) pubsubs[channel] = [];
                        pubsubs[channel].push(cb);
                    },
                },
            },
            config: { serverConfig: { roomStream: { scope } } },
        },
        backend: {
            _handlers: {},
            on(event, cb) { this._handlers[event] = cb; },
        },
    };
}

/**
 * Load a fresh copy of backend.js (clears require cache), call setupBackend(),
 * fast-forward through the 2s startup delays (by replacing setTimeout with a
 * 0ms version), then register Express routes.
 *
 * Returns a promise so that before() hooks can await it.
 */
async function freshSetup(opts = {}) {
    const modPath = require.resolve('../lib/backend');
    delete require.cache[modPath];

    const config = makeConfig(opts);

    // Replace global setTimeout with a 0ms version so startup subscriptions
    // register after one event loop turn instead of after 2 real seconds.
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn, _delay) => realSetTimeout(fn, 0);
    require('../lib/backend')(config);
    global.setTimeout = realSetTimeout;

    // Allow the now-0ms timeouts to fire (startTickSignal, startConsolePubSub).
    await new Promise(resolve => realSetTimeout(resolve, 20));

    const routes = {};
    const app = {
        get(path, ...handlers) { routes[path] = handlers; },
        _routes: routes,
    };
    config.backend._handlers['expressPreConfig'](app);

    return { config, app };
}

/** Run an Express middleware chain; returns true if all handlers called next(). */
async function chain(handlers, req, res) {
    for (const handler of handlers) {
        let calledNext = false;
        await new Promise(resolve => {
            const next = () => { calledNext = true; resolve(); };
            const result = handler(req, res, next);
            if (result && typeof result.then === 'function') {
                result.then(() => { if (!calledNext) resolve(); }).catch(resolve);
            } else {
                // Sync handler (auth middleware) — resolve after one tick so
                // its internal async work (env.get promise) can complete.
                setImmediate(resolve);
            }
        });
        if (!calledNext) return false;
    }
    return true;
}

/** Mock HTTP request. */
function makeReq({ token = null, query = {} } = {}) {
    const listeners = {};
    return {
        headers: token ? { 'x-token': token } : {},
        query,
        socket: { setTimeout() {}, setNoDelay() {} },
        userId: null,
        on(event, cb) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(cb);
        },
        _emit(event) {
            (listeners[event] || []).forEach(cb => cb());
        },
    };
}

/** Mock HTTP response. */
function makeRes() {
    const writes = [];
    let _statusCode = null;
    let _jsonBody   = null;

    return {
        writes,
        get statusCode() { return _statusCode; },
        get jsonBody()   { return _jsonBody; },
        status(code)     { _statusCode = code; return this; },
        json(body)       { _jsonBody = body; return this; },
        setHeader()      {},
        flushHeaders()   {},
        write(chunk)     { writes.push(chunk); },
    };
}

/**
 * Flush async I/O (including zlib.gzip thread pool callbacks).
 *
 * A short real timeout is the most reliable way to outlast:
 *   1. Promise microtasks (env.get resolution)
 *   2. libuv thread pool work (zlib.gzip)
 *   3. The resulting Promise resolution back on the main thread
 */
function flush() {
    return new Promise(resolve => setTimeout(resolve, 20));
}

/**
 * Connect to an SSE endpoint; returns { req, res }. Caller must close when done.
 *
 * Awaits chain() so the SSE handler (and its client registration) is guaranteed
 * complete before this function returns. chain() resolves once the sync SSE
 * handler has run (via the setImmediate it waits on internally).
 */
async function connect(handlers, tokenOrReqOpts, queryOpts = {}) {
    const reqOpts = typeof tokenOrReqOpts === 'string'
        ? { token: tokenOrReqOpts, query: queryOpts }
        : tokenOrReqOpts;
    const req = makeReq(reqOpts);
    const res = makeRes();
    await chain(handlers, req, res);
    return { req, res };
}

/** Number of data frames in a response's writes. */
function dataFrames(res) {
    return res.writes.filter(w => w.startsWith('data:'));
}

// ---------------------------------------------------------------------------
// requireXToken middleware
// ---------------------------------------------------------------------------

describe('requireXToken middleware', () => {
    let app;

    before(async () => {
        ({ app } = await freshSetup());
    });

    it('rejects with 401 when X-Token header is missing', async () => {
        const [auth] = app._routes['/api/picklenet/room-stream'];
        const req = makeReq({ token: null });
        const res = makeRes();
        await chain([auth], req, res);

        assert.equal(res.statusCode, 401);
        assert.equal(res.jsonBody.ok, 0);
    });

    it('rejects with 401 when token is not in env', async () => {
        const [auth] = app._routes['/api/picklenet/room-stream'];
        const req = makeReq({ token: 'unknown-token' });
        const res = makeRes();
        await chain([auth], req, res);
        await flush();

        assert.equal(res.statusCode, 401);
        assert.equal(res.jsonBody.ok, 0);
    });

    it('calls next() and sets req.userId when token is valid', async () => {
        const [auth] = app._routes['/api/picklenet/room-stream'];
        const req = makeReq({ token: 'tok-a' });
        const res = makeRes();

        let nextCalled = false;
        await new Promise(resolve => {
            auth(req, res, () => { nextCalled = true; resolve(); });
        });

        assert.equal(nextCalled, true);
        assert.equal(req.userId, 'user-a');
    });
});

// ---------------------------------------------------------------------------
// GET /api/picklenet/room-stream
// ---------------------------------------------------------------------------

describe('GET /api/picklenet/room-stream', () => {
    let config, app;

    before(async () => {
        ({ config, app } = await freshSetup({
            objects: [
                { _id: '1', type: 'spawn', room: 'W1N1', x: 10, y: 10, user: 'user-a' },
                { _id: '2', type: 'creep', room: 'W2N2', x:  5, y:  5, user: 'user-a' },
            ],
        }));
    });

    it('returns 400 when rooms param is missing', async () => {
        const handlers = app._routes['/api/picklenet/room-stream'];
        const req = makeReq({ token: 'tok-a', query: {} });
        const res = makeRes();
        await chain(handlers, req, res);
        await flush();

        assert.equal(res.statusCode, 400);
        assert.match(res.jsonBody.error, /rooms/);
    });

    it('returns 400 when more than 20 rooms are requested', async () => {
        const handlers = app._routes['/api/picklenet/room-stream'];
        const rooms = Array.from({ length: 21 }, (_, i) => `W${i}N1`).join(',');
        const req = makeReq({ token: 'tok-a', query: { rooms } });
        const res = makeRes();
        await chain(handlers, req, res);
        await flush();

        assert.equal(res.statusCode, 400);
        assert.match(res.jsonBody.error, /[Tt]oo many/);
    });

    it('establishes SSE connection with ok comment', async () => {
        const handlers = app._routes['/api/picklenet/room-stream'];
        const { req, res } = await connect(handlers, 'tok-a', { rooms: 'W1N1' });

        try {
            assert.ok(res.writes.some(w => w.includes(': ok')));
        } finally {
            req._emit('close');
        }
    });

    it('pushes per-tick frame with room objects', async () => {
        const handlers = app._routes['/api/picklenet/room-stream'];
        const { req, res } = await connect(handlers, 'tok-a', { rooms: 'W1N1' });

        try {
            config._pubsubs['roomsDone'][0]('42');
            await flush();

            const frames = dataFrames(res);
            assert.equal(frames.length, 1);
            const frame = JSON.parse(frames[0].replace('data: ', ''));
            assert.equal(frame.tick, 42);
            assert.ok(Array.isArray(frame.rooms['W1N1']));
            assert.equal(frame.rooms['W1N1'][0].type, 'spawn');
        } finally {
            req._emit('close');
        }
    });

    it('only includes subscribed rooms in the frame', async () => {
        const handlers = app._routes['/api/picklenet/room-stream'];
        const { req, res } = await connect(handlers, 'tok-a', { rooms: 'W2N2' });

        try {
            config._pubsubs['roomsDone'][0]('43');
            await flush();

            const frame = JSON.parse(dataFrames(res)[0].replace('data: ', ''));
            assert.ok(!('W1N1' in frame.rooms));
            assert.ok('W2N2' in frame.rooms);
        } finally {
            req._emit('close');
        }
    });

    it('removes client and stops sending frames after disconnect', async () => {
        const handlers = app._routes['/api/picklenet/room-stream'];
        const { req, res } = await connect(handlers, 'tok-a', { rooms: 'W1N1' });

        req._emit('close');
        await flush();

        const before = res.writes.length;
        config._pubsubs['roomsDone'][0]('99');
        await flush();

        assert.equal(res.writes.length, before);
    });

    it('respects scope=own and filters out rooms the user does not control', async () => {
        const { config: cfg, app: scopedApp } = await freshSetup({
            scope: 'own',
            objects: [
                { _id: 'c1', type: 'controller', room: 'W1N1', user: 'user-a' },
                { _id: 'c2', type: 'controller', room: 'W2N2', user: 'user-b' },
            ],
        });

        const handlers = scopedApp._routes['/api/picklenet/room-stream'];
        const { req, res } = await connect(handlers, 'tok-a', { rooms: 'W1N1,W2N2' });

        try {
            cfg._pubsubs['roomsDone'][0]('7');
            await flush();

            const frame = JSON.parse(dataFrames(res)[0].replace('data: ', ''));
            assert.ok('W1N1' in frame.rooms,  'W1N1 should be present');
            assert.ok(!('W2N2' in frame.rooms), 'W2N2 should be filtered');
        } finally {
            req._emit('close');
        }
    });
});

// ---------------------------------------------------------------------------
// GET /api/picklenet/console-stream
// ---------------------------------------------------------------------------

describe('GET /api/picklenet/console-stream', () => {
    let config, app;

    before(async () => {
        ({ config, app } = await freshSetup());
    });

    function emit(cfg, userId, logs = [], errors = []) {
        cfg._pubsubs['user:*/console'][0](JSON.stringify({
            userId,
            messages: { log: logs, error: errors },
        }));
    }

    it('establishes SSE connection with ok comment', async () => {
        const handlers = app._routes['/api/picklenet/console-stream'];
        const { req, res } = await connect(handlers, 'tok-a');

        try {
            assert.ok(res.writes.some(w => w.includes(': ok')));
        } finally {
            req._emit('close');
        }
    });

    it('replays buffered messages for the authenticated user on connect', async () => {
        // Pre-populate the buffer before connecting
        emit(config, 'user-a', ['buffered line']);

        const handlers = app._routes['/api/picklenet/console-stream'];
        const { req, res } = await connect(handlers, 'tok-a');

        try {
            const frames = dataFrames(res);
            assert.ok(frames.length >= 1);
            const frame = JSON.parse(frames[0].replace('data: ', ''));
            assert.equal(frame.text, 'buffered line');
            assert.equal(frame.type, 'log');
            assert.ok(typeof frame.ts === 'number');
        } finally {
            req._emit('close');
        }
    });

    it('does not replay buffered messages belonging to another user', async () => {
        emit(config, 'user-b', ['other user msg']);

        const handlers = app._routes['/api/picklenet/console-stream'];
        const { req, res } = await connect(handlers, 'tok-a');

        try {
            const frames = dataFrames(res);
            const otherMsg = frames.some(f => f.includes('other user msg'));
            assert.equal(otherMsg, false);
        } finally {
            req._emit('close');
        }
    });

    it('delivers live log messages to the correct user', async () => {
        const handlers = app._routes['/api/picklenet/console-stream'];
        const { req, res } = await connect(handlers, 'tok-a');

        try {
            const before = dataFrames(res).length;
            emit(config, 'user-a', ['hello world']);
            await flush();

            const frames = dataFrames(res);
            assert.ok(frames.length > before);
            const last = JSON.parse(frames[frames.length - 1].replace('data: ', ''));
            assert.equal(last.text, 'hello world');
            assert.equal(last.type, 'log');
        } finally {
            req._emit('close');
        }
    });

    it('delivers error messages with type=error', async () => {
        const handlers = app._routes['/api/picklenet/console-stream'];
        const { req, res } = await connect(handlers, 'tok-a');

        try {
            emit(config, 'user-a', [], ['boom!']);
            await flush();

            const frames = dataFrames(res);
            const last = JSON.parse(frames[frames.length - 1].replace('data: ', ''));
            assert.equal(last.text, 'boom!');
            assert.equal(last.type, 'error');
        } finally {
            req._emit('close');
        }
    });

    it('does not deliver messages intended for a different user', async () => {
        const handlers = app._routes['/api/picklenet/console-stream'];
        const { req, res } = await connect(handlers, 'tok-a');

        try {
            const before = res.writes.length;
            emit(config, 'user-b', ['not for you']);
            await flush();

            assert.equal(res.writes.length, before);
        } finally {
            req._emit('close');
        }
    });

    it('removes client on disconnect', async () => {
        const handlers = app._routes['/api/picklenet/console-stream'];
        const { req, res } = await connect(handlers, 'tok-a');

        req._emit('close');
        await flush();

        const before = res.writes.length;
        emit(config, 'user-a', ['after close']);
        await flush();

        assert.equal(res.writes.length, before);
    });
});

// ---------------------------------------------------------------------------
// GET /api/picklenet/memory-stream
// ---------------------------------------------------------------------------

describe('GET /api/picklenet/memory-stream', () => {
    let config, app;

    before(async () => {
        ({ config, app } = await freshSetup({
            memory: { 'user-a': '{"energy":100,"creeps":{}}' },
        }));
    });

    it('establishes SSE connection with ok comment', async () => {
        const handlers = app._routes['/api/picklenet/memory-stream'];
        const { req, res } = await connect(handlers, 'tok-a');

        try {
            assert.ok(res.writes.some(w => w.includes(': ok')));
        } finally {
            req._emit('close');
        }
    });

    it('pushes per-tick frame with gz-encoded memory matching raw JSON', async () => {
        const handlers = app._routes['/api/picklenet/memory-stream'];
        const { req, res } = await connect(handlers, 'tok-a');

        try {
            config._pubsubs['roomsDone'][0]('55');
            await flush();

            const frames = dataFrames(res);
            assert.equal(frames.length, 1);
            const frame = JSON.parse(frames[0].replace('data: ', ''));
            assert.equal(frame.tick, 55);
            assert.ok(typeof frame.data === 'string', 'data should be a string');
            assert.ok(frame.data.startsWith('gz:'),   'data should be gz: prefixed');

            const decoded = zlib.gunzipSync(Buffer.from(frame.data.slice(3), 'base64')).toString('utf8');
            assert.deepEqual(JSON.parse(decoded), { energy: 100, creeps: {} });
        } finally {
            req._emit('close');
        }
    });

    it('removes client on disconnect', async () => {
        const handlers = app._routes['/api/picklenet/memory-stream'];
        const { req, res } = await connect(handlers, 'tok-a');

        req._emit('close');
        await flush();

        const before = res.writes.length;
        config._pubsubs['roomsDone'][0]('60');
        await flush();

        assert.equal(res.writes.length, before);
    });

    it('fetches memory once per userId even with multiple clients connected', async () => {
        const handlers = app._routes['/api/picklenet/memory-stream'];
        const { req: req1, res: res1 } = await connect(handlers, 'tok-a');
        const { req: req2, res: res2 } = await connect(handlers, 'tok-a');

        let envGetCount = 0;
        const origGet = config.common.storage.env.get;
        config.common.storage.env.get = function(key) {
            if (key === 'memory:user-a') envGetCount++;
            return origGet.call(this, key);
        };

        try {
            config._pubsubs['roomsDone'][0]('70');
            await flush();

            assert.equal(dataFrames(res1).length, 1, 'client 1 should receive frame');
            assert.equal(dataFrames(res2).length, 1, 'client 2 should receive frame');
            assert.equal(envGetCount, 1, 'env.get should be called once per userId');
        } finally {
            config.common.storage.env.get = origGet;
            req1._emit('close');
            req2._emit('close');
        }
    });

    it('sends empty object when user has no memory entry', async () => {
        const { config: cfg, app: emptyApp } = await freshSetup({ memory: {} });

        const handlers = emptyApp._routes['/api/picklenet/memory-stream'];
        const { req, res } = await connect(handlers, 'tok-a');

        try {
            cfg._pubsubs['roomsDone'][0]('80');
            await flush();

            const frame = JSON.parse(dataFrames(res)[0].replace('data: ', ''));
            const decoded = zlib.gunzipSync(Buffer.from(frame.data.slice(3), 'base64')).toString('utf8');
            assert.deepEqual(JSON.parse(decoded), {});
        } finally {
            req._emit('close');
        }
    });
});
