'use strict';

/* screepsmod-picklenet
 *
 * Provides a Game.picklenet API surface in player sandboxes for future
 * server-side actions.
 *
 * Architecture overview:
 *   Engine layer — hooks driver.getRuntimeData and driver.config.makeGameObject
 *                  (same pattern as screepsmod-features) to inject the
 *                  Game.picklenet object into every player's sandbox each tick.
 *
 * Spawn management is handled manually via scripts/spawn-user.js.
 */

module.exports = function(config) {
    if (config.engine) {
        setupEngineHooks(config);
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
