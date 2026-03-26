'use strict';

const path = require('path');
const fs = require('fs');

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Screeps Visualizer - Login</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    background: #0a0a0a;
    color: #ccc;
    font-family: monospace;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
}
form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 280px;
}
h2 { color: #fff; margin-bottom: 4px; }
input {
    background: #1a1a1a;
    border: 1px solid #333;
    color: #fff;
    padding: 8px 10px;
    font-family: monospace;
    font-size: 14px;
}
input:focus { outline: none; border-color: #555; }
button {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #fff;
    padding: 8px;
    font-family: monospace;
    font-size: 14px;
    cursor: pointer;
}
button:hover { background: #333; }
.error { color: #e74c3c; font-size: 13px; }
</style>
</head>
<body>
<form method="POST" action="/visualizer/login">
    <h2>Screeps Visualizer</h2>
    {{ERROR}}
    <input type="text" name="username" placeholder="Username" autofocus required />
    <input type="password" name="password" placeholder="Password" required />
    <button type="submit">Sign in</button>
</form>
</body>
</html>`;

function parseCookies(req) {
    const raw = req.headers.cookie || '';
    return Object.fromEntries(raw.split(';').map(c => {
        const [k, ...v] = c.trim().split('=');
        return [k, decodeURIComponent(v.join('='))];
    }).filter(([k]) => k));
}

module.exports = function(config) {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

    let authlib;
    try {
        authlib = require('@screeps/backend/lib/authlib');
    } catch(e) {
        console.log('[screepsmod-visualizer] authlib not available, auth disabled');
    }

    async function requireAuth(req, res, next) {
        if (!authlib || !config.auth) return next();
        const cookies = parseCookies(req);
        const token = cookies['viz_token'];
        if (!token) return res.redirect('/visualizer/login');
        try {
            await authlib.checkToken(token, true);
            next();
        } catch(e) {
            res.redirect('/visualizer/login');
        }
    }

    config.backend.on('expressPreConfig', function(app) {

        app.get('/visualizer/login', function(req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(LOGIN_HTML.replace('{{ERROR}}', ''));
        });

        app.post('/visualizer/login', async function(req, res) {
            const { username, password } = req.body || {};
            if (!username || !password) {
                return res.status(400).send(LOGIN_HTML.replace('{{ERROR}}', '<span class="error">Username and password required.</span>'));
            }
            try {
                const user = await config.auth.authUser(username, password);
                const token = await authlib.genToken(user._id);
                res.setHeader('Set-Cookie', `viz_token=${encodeURIComponent(token)}; Path=/visualizer; HttpOnly`);
                res.redirect('/visualizer');
            } catch(e) {
                res.send(LOGIN_HTML.replace('{{ERROR}}', '<span class="error">Invalid username or password.</span>'));
            }
        });

        app.get('/visualizer', requireAuth, function(req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        });

        app.get('/visualizer/api/rooms', requireAuth, async function(req, res) {
            try {
                const db = config.common.storage.db;
                const rooms = await db['rooms'].find({});
                const names = rooms.map(r => r._id).filter(Boolean).sort();
                res.json({ ok: 1, rooms: names });
            } catch(e) {
                res.status(500).json({ ok: 0, error: e.message });
            }
        });

        app.get('/visualizer/api/terrain', requireAuth, async function(req, res) {
            const room = req.query.room;
            if (!room) return res.status(400).json({ ok: 0, error: 'room required' });
            try {
                const db = config.common.storage.db;
                const doc = await db['rooms.terrain'].findOne({ room });
                res.json({ ok: 1, terrain: doc ? (doc.terrain || doc.data || null) : null });
            } catch(e) {
                res.status(500).json({ ok: 0, error: e.message });
            }
        });

        app.get('/visualizer/api/objects', requireAuth, async function(req, res) {
            const room = req.query.room;
            if (!room) return res.status(400).json({ ok: 0, error: 'room required' });
            try {
                const { db, env } = config.common.storage;
                const [objects, gameTime] = await Promise.all([
                    db['rooms.objects'].find({ room }),
                    env ? env.get('gameTime').catch(() => null) : Promise.resolve(null),
                ]);
                res.json({
                    ok: 1,
                    objects: objects || [],
                    gameTime: gameTime ? parseInt(gameTime) : null,
                });
            } catch(e) {
                res.status(500).json({ ok: 0, error: e.message });
            }
        });
    });
};
