'use strict';

/* screepsmod-picklenet
 *
 * Player-facing API surface for the picklenet private server.
 *
 * Engine process  → lib/engine.js
 *   - Injects Game.picklenet into every player sandbox each tick
 *
 * Backend process → lib/backend.js
 *   - GET /api/picklenet/room-stream  (SSE, X-Token auth)
 *   - Subscribes to built-in 'roomsDone' pubsub for tick signal
 */

module.exports = function(config) {
    if (config.engine)  require('./lib/engine')(config);
    if (config.backend) require('./lib/backend')(config);
};
