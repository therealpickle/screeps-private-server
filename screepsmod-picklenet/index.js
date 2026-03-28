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
 *   2. Auto-spawn polling — a setInterval scans all users every AUTO_SPAWN_POLL_MS
 *                           and spawns any who have no rooms.
 */

const AUTO_SPAWN_POLL_MS = 30000;

module.exports = function(config) {
    if (config.engine) {
        setupEngineHooks(config);
    } else {
        console.log('[picklenet] config.engine not available — Game.picklenet will not be injected');
    }

    if (config.common) {
        /* Delay startup to ensure config.common.storage is fully initialised.
         * The visualizer mod uses the same pattern. */
        setTimeout(function() {
            startAutoSpawnPolling(config);
        }, 3000);
    } else {
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
    const { db } = config.common.storage;

    setInterval(function() {
        db['users'].find({})
            .then(function(users) {
                const unroomed = users.filter(function(u) {
                    return !u.rooms || u.rooms.length === 0;
                });
                unroomed.forEach(function(u) {
                    processSpawnRequest(db, u._id)
                        .catch(function(err) {
                            console.error('[picklenet] auto-spawn error for userId=' + u._id + ':', err.message);
                        });
                });
            })
            .catch(function(err) {
                console.error('[picklenet] auto-spawn poll error:', err.message);
            });
    }, AUTO_SPAWN_POLL_MS);
}

/* Guard: skip users who already have a spawn (makes auto-spawn idempotent). */
async function processSpawnRequest(db, userId) {
    const existingSpawn = await db['rooms.objects'].findOne({ type: 'spawn', user: userId });
    if (existingSpawn) {
        console.log('[picklenet] userId=' + userId + ' already has a spawn in ' + existingSpawn.room + ', ignoring');
        return;
    }

    await spawnUser(db, userId);
}

async function spawnUser(db, userId) {
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
        /* Exclude the 2-tile border so the spawn doesn't block room exits. */
        if (x < 2 || x > 47 || y < 2 || y > 47) return false;
        return (parseInt(terrain[y * 50 + x]) & 1) === 0;
    }

    /* Chebyshev-distance spiral outward from room centre (25, 25).
     * We only visit each shell's perimeter (the inner `continue` skips interior
     * tiles), so the first hit is genuinely the nearest walkable tile. */
    let spawnX = -1, spawnY = -1;
    for (let r = 0; r <= 24 && spawnX === -1; r++) {
        for (let dx = -r; dx <= r && spawnX === -1; dx++) {
            for (let dy = -r; dy <= r && spawnX === -1; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // interior tile — skip
                const x = 25 + dx, y = 25 + dy;
                if (isWalkable(x, y)) { spawnX = x; spawnY = y; }
            }
        }
    }

    if (spawnX === -1) {
        console.error('[picklenet] no walkable tile found in ' + room + ' for userId=' + userId);
        return;
    }

    console.log('[picklenet] spawning userId=' + userId + ' in ' + room + ' at (' + spawnX + ', ' + spawnY + ')');

    /* Claim the controller at RCL 1.  20 000-tick downgrade timer gives the
     * player time to start upgrading before losing the room.  Safe mode covers
     * the same window so they aren't immediately attackable. */
    await db['rooms.objects'].update({ _id: ctrl._id }, {
        $set: {
            user: userId,
            level: 1,
            progress: 0,
            downgradeTime: 20000,
            safeMode: 20000,
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
    await db['users'].update({ _id: userId }, { $set: { rooms: [room] } });

    console.log('[picklenet] userId=' + userId + ' spawned successfully in ' + room);
}
