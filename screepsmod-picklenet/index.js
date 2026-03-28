'use strict';

/* screepsmod-picklenet
 *
 * Adds a Game.picklenet API to player sandboxes so bot code can request
 * server-side actions without leaving the game engine.
 *
 * Current API surface:
 *   Game.picklenet.requestSpawn([options])
 *     — places a spawn for the calling user.  Idempotent: if the user
 *       already has a spawn the request is silently dropped.
 *
 *     options (all optional):
 *       name  {string}  Spawn name.  Defaults to 'Spawn1'.
 *       room  {string}  Room name (e.g. 'W3N4').  If omitted, a random
 *                       unowned room is chosen.
 *       x     {number}  X coordinate.  Must be paired with y.
 *                       Requires room to also be specified.
 *       y     {number}  Y coordinate.  Must be paired with x.
 *                       Requires room to also be specified.
 *
 *     Throws if arguments are inconsistent (x without y, x/y without room).
 *     If no x/y are given, places the spawn as close to room centre (25,25)
 *     as possible, keeping a 2-tile border clear.
 *
 * Architecture overview:
 *   1. Engine layer  — hooks driver.getRuntimeData and driver.config.makeGameObject
 *                      (same pattern as screepsmod-features) to inject the
 *                      Game.picklenet object into every player's sandbox each tick.
 *                      Calling Game.picklenet.requestSpawn() enqueues the userId
 *                      and its options into a module-level Map — no DB writes
 *                      happen on the hot path.
 *
 *   2. Polling layer — a setInterval drains the pending Map every
 *                      POLL_INTERVAL_MS milliseconds, performs the DB writes, and
 *                      logs the result.  The 3 s startup delay lets config.common
 *                      finish initialising before we touch storage.
 */

const POLL_INTERVAL_MS = 2000;

module.exports = function(config) {
    /* Shared queue between the engine layer (producer) and polling layer (consumer).
     * Using a Map of userId -> options means multiple calls per tick from the same
     * user collapse into one spawn attempt; the last call's options win. */
    const spawnRequests = new Map();

    if (config.engine) {
        setupEngineHooks(config, spawnRequests);
    } else {
        console.log('[picklenet] config.engine not available — Game.picklenet will not be injected');
    }

    if (config.common) {
        /* Delay startup to ensure config.common.storage is fully initialised.
         * The visualizer mod uses the same pattern. */
        setTimeout(function() {
            startPolling(config, spawnRequests);
        }, 3000);
    } else {
        console.log('[picklenet] config.common not available — spawn polling will not start');
    }
};

// ---- Engine hooks -------------------------------------------------------
//
// The Screeps engine builds each player's Game object via two driver methods:
//
//   driver.getRuntimeData(userId, onlyInRoom)
//     → fetches all data the player's VM will need for this tick (room objects,
//       creeps, structures, memory, etc.) and returns it as a plain JS object.
//
//   driver.config.makeGameObject(runtimeData, ...)
//     → turns that data into the Game object visible inside the player's sandbox.
//
// We wrap both: getRuntimeData threads userId into runtimeData so makeGameObject
// can read it back, then makeGameObject attaches Game.picklenet with a closure
// that captures userId.

function setupEngineHooks(config, spawnRequests) {
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
     * arguments[0] is runtimeData (the object returned by getRuntimeData above).
     * The requestSpawn closure captures userId so the polling layer knows whose
     * spawn to place when it drains the queue. */
    const oldMakeGameObject = driver.config.makeGameObject;
    driver.config.makeGameObject = function() {
        const game = oldMakeGameObject.apply(this, arguments);
        const userId = arguments[0] && arguments[0]._picklenetUserId;

        game.picklenet = {
            /* Enqueue a spawn request for this user.  The actual DB work happens
             * in the polling loop so we don't block the tick pipeline.
             *
             * Throws on invalid argument combinations so the player gets immediate
             * feedback in their console. */
            requestSpawn: function(options) {
                if (!userId) return;

                options = options || {};

                const hasX = options.x !== undefined;
                const hasY = options.y !== undefined;

                if (hasX !== hasY) {
                    throw new Error('[picklenet] requestSpawn: x and y must both be specified or both omitted');
                }
                if (hasX && !options.room) {
                    throw new Error('[picklenet] requestSpawn: room must be specified when x and y are given');
                }

                spawnRequests.set(userId, {
                    name: options.name || 'Spawn1',
                    room: options.room || null,
                    x: hasX ? options.x : null,
                    y: hasY ? options.y : null,
                });
            },
        };

        return game;
    };
}

// ---- Spawn polling -------------------------------------------------------
//
// Runs every POLL_INTERVAL_MS.  Drains the spawnRequests Map and fires off an
// async spawn attempt for each userId.  Errors are caught per-user so one
// failure doesn't prevent others from being processed.

function startPolling(config, spawnRequests) {
    const { db } = config.common.storage;

    setInterval(function() {
        if (spawnRequests.size === 0) return;

        /* Snapshot and immediately clear the map so new requests that arrive
         * during async processing land in the next batch, not this one. */
        const pending = Array.from(spawnRequests.entries());
        spawnRequests.clear();

        pending.forEach(function([userId, options]) {
            processSpawnRequest(db, userId, options)
                .catch(function(err) {
                    console.error('[picklenet] error spawning userId=' + userId + ':', err.message);
                });
        });
    }, POLL_INTERVAL_MS);
}

/* Guard: skip users who already have a spawn (makes requestSpawn idempotent). */
async function processSpawnRequest(db, userId, options) {
    const existingSpawn = await db['rooms.objects'].findOne({ type: 'spawn', user: userId });
    if (existingSpawn) {
        console.log('[picklenet] userId=' + userId + ' already has a spawn in ' + existingSpawn.room + ', ignoring request');
        return;
    }

    await spawnUser(db, userId, options);
}

async function spawnUser(db, userId, options) {
    const spawnName = options.name || 'Spawn1';

    /* Resolve the target controller — either the explicitly requested room or a
     * randomly chosen unowned one. */
    let ctrl;
    if (options.room) {
        ctrl = await db['rooms.objects'].findOne({ type: 'controller', room: options.room, level: 0 });
        if (!ctrl) {
            console.error('[picklenet] room ' + options.room + ' not found or already owned, cannot spawn userId=' + userId);
            return;
        }
    } else {
        const controllers = await db['rooms.objects'].find({ type: 'controller', level: 0 });
        if (!controllers.length) {
            console.error('[picklenet] no unowned rooms available for userId=' + userId);
            return;
        }
        ctrl = controllers[Math.floor(Math.random() * controllers.length)];
    }

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

    let spawnX, spawnY;

    if (options.x !== null) {
        /* Explicit position requested — validate it's actually walkable. */
        if (!isWalkable(options.x, options.y)) {
            console.error('[picklenet] requested position (' + options.x + ', ' + options.y + ') in ' + room + ' is not walkable for userId=' + userId);
            return;
        }
        spawnX = options.x;
        spawnY = options.y;
    } else {
        /* Chebyshev-distance spiral outward from room centre (25, 25).
         * We only visit each shell's perimeter (the inner `continue` skips interior
         * tiles), so the first hit is genuinely the nearest walkable tile.
         * Same algorithm as scripts/spawn-user.js. */
        spawnX = -1; spawnY = -1;
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
    }

    console.log('[picklenet] spawning userId=' + userId + ' in ' + room + ' at (' + spawnX + ', ' + spawnY + ') name=' + spawnName);

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
        name: spawnName,
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
