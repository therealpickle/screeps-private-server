'use strict';

/* Engine hooks for screepsmod-picklenet.
 *
 * Runs in the engine process. Wraps driver methods to inject
 * Game.picklenet into every player sandbox each tick.
 */

module.exports = function setupEngineHooks(config) {
    const driver = config.engine.driver;

    const oldGetRuntimeData = driver.getRuntimeData;
    driver.getRuntimeData = function(userId, onlyInRoom) {
        return oldGetRuntimeData.call(this, userId, onlyInRoom).then(function(runtimeData) {
            runtimeData._picklenetUserId = userId;
            return runtimeData;
        });
    };

    const oldMakeGameObject = driver.config.makeGameObject;
    driver.config.makeGameObject = function() {
        const game = oldMakeGameObject.apply(this, arguments);
        game.picklenet = {};
        return game;
    };
};
