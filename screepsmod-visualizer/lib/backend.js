'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
    <input type="hidden" name="next" value="{{NEXT}}" />
    <input type="text" name="username" placeholder="Username" autofocus required />
    <input type="password" name="password" placeholder="Password" required />
    <button type="submit">Sign in</button>
</form>
</body>
</html>`;

function parseFormBody(req, callback) {
    let body = '';
    req.on('data', function(chunk) { body += chunk.toString(); });
    req.on('end', function() {
        const params = {};
        body.split('&').forEach(function(pair) {
            const idx = pair.indexOf('=');
            if (idx < 0) return;
            try {
                params[decodeURIComponent(pair.slice(0, idx).replace(/\+/g, ' '))] =
                    decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
            } catch(e) {}
        });
        callback(params);
    });
}

function parseCookies(req) {
    const result = {};
    (req.headers.cookie || '').split(';').forEach(function(c) {
        const idx = c.indexOf('=');
        if (idx < 0) return;
        const k = c.slice(0, idx).trim();
        if (!k) return;
        try { result[k] = decodeURIComponent(c.slice(idx + 1).trim()); }
        catch(e) { result[k] = c.slice(idx + 1).trim(); }
    });
    return result;
}

function makeToken(userId, secret) {
    const expires = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    const payload = `${userId}:${expires}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return Buffer.from(`${payload}:${sig}`).toString('base64');
}

function verifyToken(token, secret) {
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const parts = decoded.split(':');
        if (parts.length !== 3) return false;
        const [userId, expires, sig] = parts;
        if (Date.now() > parseInt(expires)) return false;
        const payload = `${userId}:${expires}`;
        const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? userId : false;
    } catch(e) {
        return false;
    }
}

module.exports = function(config) {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const css  = fs.readFileSync(path.join(__dirname, '../public/visualizer.css'), 'utf8');
    const secret = crypto.randomBytes(32).toString('hex');

    function requireAuth(req, res, next) {
        if (!config.auth) return next();
        const cookies = parseCookies(req);
        const token = cookies['viz_token'];
        if (!token || !verifyToken(token, secret)) {
            if (req.path.startsWith('/visualizer/api/')) {
                return res.status(401).json({ ok: 0, error: 'Unauthorized' });
            }
            return res.redirect('/visualizer/login?next=' + encodeURIComponent(req.url));
        }
        next();
    }

    config.backend.on('expressPreConfig', function(app) {

        app.get('/visualizer/login', function(req, res) {
            const next = req.query.next || '/visualizer';
            const html = LOGIN_HTML
                .replace('{{ERROR}}', '')
                .replace('{{NEXT}}', next.replace(/"/g, ''));
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        });

        app.post('/visualizer/login', function(req, res) {
            parseFormBody(req, function(body) {
                const username = body.username;
                const password = body.password;
                const next = (body.next && body.next.startsWith('/visualizer')) ? body.next : '/visualizer';
                if (!username || !password || !config.auth) {
                    return res.status(400).send(LOGIN_HTML.replace('{{ERROR}}', '<span class="error">Username and password required.</span>').replace('{{NEXT}}', next));
                }
                config.auth.authUser(username, password)
                    .then(function(user) {
                        if (!user) {
                            return res.send(LOGIN_HTML.replace('{{ERROR}}', '<span class="error">Invalid username or password.</span>').replace('{{NEXT}}', next));
                        }
                        const token = makeToken(user._id, secret);
                        res.setHeader('Set-Cookie', 'viz_token=' + encodeURIComponent(token) + '; Path=/visualizer; HttpOnly; SameSite=Lax');
                        res.redirect(next);
                    })
                    .catch(function() {
                        res.send(LOGIN_HTML.replace('{{ERROR}}', '<span class="error">Login error. Please try again.</span>').replace('{{NEXT}}', next));
                    });
            });
        });

        app.get('/visualizer/visualizer.css', function(req, res) {
            res.setHeader('Content-Type', 'text/css');
            res.setHeader('Cache-Control', 'no-store');
            res.send(css);
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
