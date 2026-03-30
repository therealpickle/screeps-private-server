// Created with Claude Code (claude.ai/code)

/* Spawns a user on the private server via the Screeps CLI.
 *
 * Usage: pipe to the CLI with a USERNAME variable set, e.g.:
 *
 *   echo 'var USERNAME="alice";' | cat - scripts/spawn-user.js \
 *     | docker compose exec -T screeps cli
 *
 * Or as a one-liner:
 *
 *   printf 'var USERNAME="alice";\n' | cat - scripts/spawn-user.js \
 *     | docker compose exec -T screeps cli
 *
 * Spawn placement:
 *   - Picks a random unowned room (controller at level 0).
 *   - Places Spawn1 at the nearest walkable tile to room centre (25, 25),
 *     preferring 2-tile clearance, then 1-tile, then any walkable tile.
 *   - Claims the controller at RCL 1 with 20 000-tick downgrade timer and
 *     safe mode.
 *   - Idempotent: skips if the user already has a spawn.
 */
(function() {
    var db = storage.db;
    var env = storage.env;

    return db['users'].findOne({ username: USERNAME })
        .then(function(u) {
            if (!u) { print('User not found: ' + USERNAME); return; }
            return db['rooms.objects'].findOne({ type: 'spawn', user: u._id })
                .then(function(existing) {
                    if (existing) { print(USERNAME + ' already has a spawn in ' + existing.room); return; }
                    return spawnUser(db, env, u._id, USERNAME);
                });
        });

    function spawnUser(db, env, userId, username) {
        return db['rooms.objects'].find({ type: 'controller', level: 0 })
            .then(function(controllers) {
                if (!controllers.length) { print('No unowned rooms available'); return; }
                var ctrl = controllers[Math.floor(Math.random() * controllers.length)];
                var room = ctrl.room;

                return db['rooms.terrain'].findOne({ room: room })
                    .then(function(terrainObj) {
                        var terrain = terrainObj.terrain;

                        function isWalkable(x, y) {
                            if (x < 3 || x > 46 || y < 3 || y > 46) return false;
                            return (parseInt(terrain[y * 50 + x]) & 1) === 0;
                        }

                        function hasClearance(x, y, c) {
                            for (var nx = x - c; nx <= x + c; nx++) {
                                for (var ny = y - c; ny <= y + c; ny++) {
                                    if (nx === x && ny === y) continue;
                                    if ((parseInt(terrain[ny * 50 + nx]) & 1) !== 0) return false;
                                }
                            }
                            return true;
                        }

                        var spawnX = -1, spawnY = -1;
                        for (var clearance = 2; clearance >= 0 && spawnX === -1; clearance--) {
                            for (var r = 0; r <= 24 && spawnX === -1; r++) {
                                for (var dx = -r; dx <= r && spawnX === -1; dx++) {
                                    for (var dy = -r; dy <= r && spawnX === -1; dy++) {
                                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                                        var x = 25 + dx, y = 25 + dy;
                                        if (isWalkable(x, y) && hasClearance(x, y, clearance)) { spawnX = x; spawnY = y; }
                                    }
                                }
                            }
                        }

                        if (spawnX === -1) { print('No walkable tile found in ' + room); return; }

                        return env.get('gameTime').then(function(gt) {
                            var gameTime = parseInt(gt) || 0;

                            return db['rooms.objects'].update({ _id: ctrl._id }, {
                                $set: {
                                    user: userId,
                                    level: 1,
                                    progress: 0,
                                    downgradeTime: gameTime + 20000,
                                    safeMode: gameTime + 20000,
                                    safeModeAvailable: 1,
                                },
                            }).then(function() {
                                return db['rooms.objects'].insert({
                                    type: 'spawn',
                                    room: room,
                                    x: spawnX,
                                    y: spawnY,
                                    name: 'Spawn1',
                                    user: userId,
                                    hits: 5000,
                                    hitsMax: 5000,
                                    spawning: null,
                                    notifyWhenAttacked: false,
                                    store: { energy: 300 },
                                    storeCapacityResource: { energy: 300 },
                                    off: false,
                                });
                            }).then(function() {
                                return db['users'].update({ _id: userId }, { $set: { rooms: [room], active: true } });
                            }).then(function() {
                                print('Spawned ' + username + ' in ' + room + ' at (' + spawnX + ', ' + spawnY + ')');
                            });
                        });
                    });
            });
    }
})()

// Created with Claude Code (claude.ai/code)
