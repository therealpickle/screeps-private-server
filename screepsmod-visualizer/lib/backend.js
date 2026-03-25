'use strict';

const path = require('path');
const fs = require('fs');

module.exports = function(config) {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

    config.backend.on('expressPreConfig', function(app) {

        app.get('/visualizer', function(req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        });

        app.get('/visualizer/api/rooms', async function(req, res) {
            try {
                const db = config.common.storage.db;
                const rooms = await db['rooms'].find({});
                const names = rooms.map(r => r._id).filter(Boolean).sort();
                res.json({ ok: 1, rooms: names });
            } catch(e) {
                res.status(500).json({ ok: 0, error: e.message });
            }
        });

        app.get('/visualizer/api/terrain', async function(req, res) {
            const room = req.query.room;
            if (!room) return res.status(400).json({ ok: 0, error: 'room required' });
            try {
                const db = config.common.storage.db;
                const doc = await db['rooms.terrain'].findOne({ _id: room });
                const terrain = doc ? (doc.terrain || doc.data || doc.encoded || null) : null;
                res.json({ ok: 1, terrain, _keys: doc ? Object.keys(doc) : [] });
            } catch(e) {
                res.status(500).json({ ok: 0, error: e.message });
            }
        });

        app.get('/visualizer/api/objects', async function(req, res) {
            const room = req.query.room;
            if (!room) return res.status(400).json({ ok: 0, error: 'room required' });
            try {
                const db = config.common.storage.db;
                const [objects, envDoc] = await Promise.all([
                    db['rooms.objects'].find({ room }),
                    db['env'].findOne({ _id: 'gameTime' }).catch(() => null),
                ]);
                res.json({
                    ok: 1,
                    objects: objects || [],
                    gameTime: envDoc ? envDoc.value : null,
                });
            } catch(e) {
                res.status(500).json({ ok: 0, error: e.message });
            }
        });
    });
};
