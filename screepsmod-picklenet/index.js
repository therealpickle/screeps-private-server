'use strict';

/* screepsmod-picklenet
 *
 * Automatically spawns users who have no rooms, and provides a Game.picklenet
 * API surface in player sandboxes for future server-side actions.
 *
 * Auto-spawn:
 *   Every AUTO_SPAWN_POLL_MS the mod scans all user accounts and places a spawn
 *   for any user with an empty rooms list.  This bootstraps brand-new accounts
 *   whose code has never run — the engine does not tick a user's code until they
 *   own at least one room, so they could never self-request a spawn.
 *
 * Spawn placement:
 *   - Picks a random unowned room (controller at level 0).
 *   - Places 'Spawn1' at the nearest walkable tile to room centre (25, 25),
 *     keeping a 2-tile border clear.
 *   - Claims the controller at RCL 1 with vanilla downgrade timer and safe mode.
 *   - Idempotent: if the user already has a spawn the attempt is skipped.
 *
 * Architecture overview:
 *   1. Engine layer  — hooks driver.getRuntimeData and driver.config.makeGameObject
 *                      (same pattern as screepsmod-features) to inject the
 *                      Game.picklenet object into every player's sandbox each tick.
 *
 *   2. Auto-spawn polling — runs only in the backend process (not engine processes)
 *                           to avoid multiple pollers racing each other.  Scans
 *                           all users every AUTO_SPAWN_POLL_MS and spawns any
 *                           who have no rooms.
 */

const AUTO_SPAWN_POLL_MS = 30000;

module.exports = function(config) {
    if (config.engine) {
        setupEngineHooks(config);
    } else {
        console.log('[picklenet] config.engine not available — Game.picklenet will not be injected');
    }

    if (config.common && !config.engine) {
        /* Only run in the backend process (no config.engine), not in each engine
         * process — otherwise every processor runs its own poller and races to
         * spawn the same users simultaneously.
         * Delay startup to ensure config.common.storage is fully initialised. */
        setTimeout(function() {
            startAutoSpawnPolling(config);
        }, 3000);
    } else if (!config.common) {
        console.log('[picklenet] config.common not available — auto-spawn polling will not start');
    }
};

// ---- Engine hooks -------------------------------------------------------
//
// The Screeps engine builds each player's Game object via two driver methods:
//
//   driver.getRuntimeData(userId, onlyInRoom)
//     → fetches all data the player's VM will need for this tick and returns
//       it as a plain JS object.
//
//   driver.config.makeGameObject(runtimeData, ...)
//     → turns that data into the Game object visible inside the player's sandbox.
//
// We wrap both: getRuntimeData threads userId into runtimeData so makeGameObject
// can read it back, then makeGameObject attaches an empty Game.picklenet object
// ready for future methods.

function setupEngineHooks(config) {
    const driver = config.engine.driver;

    /* Wrap getRuntimeData to stash userId on the runtimeData object.
     * runtimeData is an ephemeral per-tick plain object so adding a property
     * to it is safe and doesn't affect any other mod. */
    const oldGetRuntimeData = driver.getRuntimeData;
    driver.getRuntimeData = function(userId, onlyInRoom) {
        return oldGetRuntimeData.call(this, userId, onlyInRoom).then(function(runtimeData) {
            runtimeData._picklenetUserId = userId;
            return runtimeData;
        });
    };

    /* Wrap makeGameObject to attach Game.picklenet.
     * arguments[0] is runtimeData (the object returned by getRuntimeData above). */
    const oldMakeGameObject = driver.config.makeGameObject;
    driver.config.makeGameObject = function() {
        const game = oldMakeGameObject.apply(this, arguments);
        game.picklenet = {};
        return game;
    };
}

// ---- Auto-spawn polling --------------------------------------------------
//
// Runs every AUTO_SPAWN_POLL_MS.  Finds all users with no rooms and spawns
// them automatically.
//
// Fetches all users and filters in JS rather than relying on query operator
// compatibility across LokiJS and MongoDB backends.

function startAutoSpawnPolling(config) {
    const { db, env } = config.common.storage;

    setInterval(function() {
        db['users'].find({})
            .then(function(users) {
                const NPC_USERNAMES = ['Invader', 'Source Keeper', 'Screeps'];
                const unroomed = users.filter(function(u) {
                    return (!u.rooms || u.rooms.length === 0) &&
                           !u.bot &&
                           !NPC_USERNAMES.includes(u.username);
                });
                unroomed.reduce(function(chain, u) {
                    return chain.then(function() {
                        return processSpawnRequest(db, env, u._id)
                            .catch(function(err) {
                                console.error('[picklenet] auto-spawn error for userId=' + u._id + ':', err.message);
                            });
                    });
                }, Promise.resolve());
            })
            .catch(function(err) {
                console.error('[picklenet] auto-spawn poll error:', err.message);
            });
    }, AUTO_SPAWN_POLL_MS);
}

/* Guard: skip users who already have a spawn (makes auto-spawn idempotent). */
async function processSpawnRequest(db, env, userId) {
    const existingSpawn = await db['rooms.objects'].findOne({ type: 'spawn', user: userId });
    if (existingSpawn) {
        console.log('[picklenet] userId=' + userId + ' already has a spawn in ' + existingSpawn.room + ', ignoring');
        return;
    }

    await spawnUser(db, env, userId);
}

async function spawnUser(db, env, userId) {
    /* Pick a random room whose controller is still at level 0 (unowned). */
    const controllers = await db['rooms.objects'].find({ type: 'controller', level: 0 });
    if (!controllers.length) {
        console.error('[picklenet] no unowned rooms available for userId=' + userId);
        return;
    }

    const ctrl = controllers[Math.floor(Math.random() * controllers.length)];
    const room = ctrl.room;

    /* Terrain is a 2500-character string, one char per tile in row-major order
     * (index = y*50 + x).  Bit 0 of each digit: 1 = wall, 0 = plain/swamp. */
    const terrainObj = await db['rooms.terrain'].findOne({ room });
    if (!terrainObj) {
        console.error('[picklenet] no terrain found for room ' + room);
        return;
    }

    const terrain = terrainObj.terrain;

    function isWalkable(x, y) {
        /* Keep 2 tiles clear on all sides (x=3..46, y=3..46). */
        if (x < 3 || x > 46 || y < 3 || y > 46) return false;
        return (parseInt(terrain[y * 50 + x]) & 1) === 0;
    }

    function hasClearance(x, y, c) {
        /* Require all tiles within Chebyshev distance c to be non-wall. */
        for (let nx = x - c; nx <= x + c; nx++) {
            for (let ny = y - c; ny <= y + c; ny++) {
                if (nx === x && ny === y) continue;
                if ((parseInt(terrain[ny * 50 + nx]) & 1) !== 0) return false;
            }
        }
        return true;
    }

    /* Chebyshev-distance spiral outward from room centre (25, 25).
     * Try 2-tile clearance first, then 1-tile, then any walkable tile. */
    let spawnX = -1, spawnY = -1;
    for (let clearance = 2; clearance >= 0 && spawnX === -1; clearance--) {
        for (let r = 0; r <= 24 && spawnX === -1; r++) {
            for (let dx = -r; dx <= r && spawnX === -1; dx++) {
                for (let dy = -r; dy <= r && spawnX === -1; dy++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // interior tile — skip
                    const x = 25 + dx, y = 25 + dy;
                    if (isWalkable(x, y) && hasClearance(x, y, clearance)) { spawnX = x; spawnY = y; }
                }
            }
        }
    }

    if (spawnX === -1) {
        console.error('[picklenet] no walkable tile found in ' + room + ' for userId=' + userId);
        return;
    }

    console.log('[picklenet] spawning userId=' + userId + ' in ' + room + ' at (' + spawnX + ', ' + spawnY + ')');

    /* downgradeTime and safeMode are absolute game ticks, not countdowns. */
    const gameTime = parseInt(await env.get('gameTime')) || 0;

    /* Claim the controller at RCL 1.  20 000-tick downgrade timer gives the
     * player time to start upgrading before losing the room.  Safe mode covers
     * the same window so they aren't immediately attackable. */
    await db['rooms.objects'].update({ _id: ctrl._id }, {
        $set: {
            user: userId,
            level: 1,
            progress: 0,
            downgradeTime: gameTime + 20000,
            safeMode: gameTime + 20000,
            safeModeAvailable: 1,
        },
    });

    /* Insert the spawn structure.  300 energy matches vanilla Screeps defaults. */
    await db['rooms.objects'].insert({
        type: 'spawn',
        room,
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

    /* Register the room on the user record so the engine includes it in CPU
     * scheduling and room-update loops. */
    await db['users'].update({ _id: userId }, { $set: { rooms: [room], active: true } });

    console.log('[picklenet] userId=' + userId + ' spawned successfully in ' + room);
}
