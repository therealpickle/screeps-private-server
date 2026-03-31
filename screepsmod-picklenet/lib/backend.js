'use strict';

/* Backend HTTP layer for screepsmod-picklenet.
 *
 * Runs in the backend process. Registers Express routes under /api/picklenet/.
 *
 * Endpoint:
 *   GET /api/picklenet/room-stream?rooms=W1N1,W2N2
 *   X-Token: <token from /api/auth/signin>
 *
 *   SSE stream — one frame per tick:
 *   data: {"tick":12345,"rooms":{"W1N1":[...objects...],"W2N2":[...]}}
 *
 * Auth:
 *   X-Token header validated via env.get('auth_<token>') — the key written
 *   by screepsmod-auth when issuing tokens via /api/auth/signin.
 *
 * Scope (configured via config.yml serverConfig.roomStream.scope):
 *   "any"  — authenticated players may subscribe to any room (default)
 *   "own"  — only rooms whose controller is owned by the requesting player
 */

const MAX_ROOMS = 20; // per connection cap

module.exports = function setupBackend(config) {
    const storage = config.common.storage;
    const db      = storage.db;
    const env     = storage.env;
    const pubsub  = storage.pubsub;

    // ---- Auth middleware ----

    function requireXToken(req, res, next) {
        const token = req.headers['x-token'];
        if (!token) return res.status(401).json({ ok: 0, error: 'X-Token header required' });

        env.get('auth_' + token).then(function(userId) {
            if (!userId) return res.status(401).json({ ok: 0, error: 'Invalid or expired token' });
            req.userId = userId;
            next();
        }).catch(function(err) {
            console.log('[picklenet] auth error:', err);
            res.status(500).json({ ok: 0, error: 'Auth check failed' });
        });
    }

    // ---- Scope helper ----

    function getScope() {
        try {
            const sc = config.common.config && config.common.config.serverConfig;
            return (sc && sc.roomStream && sc.roomStream.scope) || 'any';
        } catch(e) {
            return 'any';
        }
    }

    async function filterRoomsByScope(rooms, userId) {
        if (getScope() !== 'own') return rooms;
        const controllers = await db['rooms.objects'].find({
            $and: [{ type: 'controller' }, { room: { $in: rooms } }]
        });
        const owned = new Set(
            controllers.filter(c => c.user === userId).map(c => c.room)
        );
        return rooms.filter(r => owned.has(r));
    }

    // ---- SSE clients ----
    // Each entry: { res, rooms: Set<string>, userId }
    const clients = [];

    // ---- Tick handler ----
    // Called on each roomsDone pubsub event.
    // Queries rooms.objects for the union of all subscribed rooms, then
    // pushes one frame per connected client.

    async function onTick(tick) {
        if (!clients.length) return;

        const roomSet = new Set();
        clients.forEach(function(c) { c.rooms.forEach(function(r) { roomSet.add(r); }); });
        const allRooms = [...roomSet];
        if (!allRooms.length) return;

        let byRoom;
        try {
            const objects = await db['rooms.objects'].find({ room: { $in: allRooms } });
            byRoom = {};
            for (const obj of objects) {
                if (!byRoom[obj.room]) byRoom[obj.room] = [];
                byRoom[obj.room].push(obj);
            }
        } catch(e) {
            return;
        }

        const payload = {};
        for (const room of allRooms) payload[room] = byRoom[room] || [];

        for (let i = clients.length - 1; i >= 0; i--) {
            const client = clients[i];
            const frame = {};
            for (const room of client.rooms) frame[room] = payload[room] || [];
            const data = 'data: ' + JSON.stringify({ tick, rooms: frame }) + '\n\n';
            try {
                client.res.write(data);
            } catch(e) {
                clients.splice(i, 1);
            }
        }
    }

    // ---- Subscribe to tick signal ----
    // 'roomsDone' is published by the screeps engine after every tick,
    // with the tick number as the message body.

    function startTickSignal() {
        pubsub.subscribe('roomsDone', function(tick) {
            onTick(parseInt(tick) || 0);
        });
    }

    setTimeout(startTickSignal, 2000);

    // ---- Express route ----

    config.backend.on('expressPreConfig', function(app) {

        app.get('/api/picklenet/room-stream', requireXToken, async function(req, res) {
            const rawRooms = (req.query.rooms || '').split(',').map(r => r.trim()).filter(Boolean);
            if (!rawRooms.length) {
                return res.status(400).json({ ok: 0, error: 'rooms query param required' });
            }
            if (rawRooms.length > MAX_ROOMS) {
                return res.status(400).json({ ok: 0, error: 'Too many rooms (max ' + MAX_ROOMS + ')' });
            }

            let rooms;
            try {
                rooms = await filterRoomsByScope(rawRooms, req.userId);
            } catch(e) {
                return res.status(500).json({ ok: 0, error: 'Scope check failed' });
            }

            if (!rooms.length) {
                return res.status(403).json({ ok: 0, error: 'No permitted rooms in request' });
            }

            req.socket.setTimeout(0);
            req.socket.setNoDelay(true);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();
            res.write(': ok\n\n');

            const client = { res, rooms: new Set(rooms), userId: req.userId };
            clients.push(client);

            const heartbeat = setInterval(function() {
                try { res.write(': heartbeat\n\n'); } catch(e) {}
            }, 15000);

            req.on('close', function() {
                clearInterval(heartbeat);
                const i = clients.indexOf(client);
                if (i >= 0) clients.splice(i, 1);
            });
        });
    });
};
