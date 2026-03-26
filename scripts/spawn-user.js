/* Spawns a user on the private server via the Screeps CLI.
 *
 * Invocation: piped to `docker compose exec -T screeps cli` by the Makefile.
 * The Makefile prepends:  var USERNAME="..."; var PASSWORD="...";
 * The CLI evaluates input line-by-line, so the Makefile flattens this file to
 * a single line with `tr '\n' ' '` before piping it.  All comments must use
 * block style (no // single-line comments) so they survive the flattening.
 *
 * This script is idempotent — re-running setup-staging skips steps already done.
 */
(function () {
  var db = storage.db;
  var env = storage.env;

  /* userId is set in the first step and shared across all subsequent .then() closures. */
  var userId;

  /* Step 1: find or create the user record.
   * screepsmod-auth's setPassword() only sets a hash on an existing record, so we
   * must insert the user ourselves if they don't exist yet. */
  return db['users'].findOne({ username: USERNAME })
    .then(function (existing) {
      if (existing) {
        print('User ' + USERNAME + ' already exists (id=' + existing._id + ')');
        userId = existing._id;
        return;
      }
      print('Creating user ' + USERNAME + '...');
      return db['users'].insert({
        username: USERNAME,
        usernameLower: USERNAME.toLowerCase(),
        cpu: 100,
        cpuAvailable: 0,        /* replenished each tick by the engine */
        registeredDate: new Date().toISOString(),
        blocked: false,
        money: 0,
        gcl: 0,
        active: true,
        authTouched: true,      /* required for the auth mod to recognise the account */
      }).then(function (user) {
        userId = user._id;
      });
    })

    /* Step 2: create the user's code bucket if it doesn't already exist.
     * The engine looks this up on every tick to run the player's AI. */
    .then(function () {
      return db['users.code'].findOne({ user: userId });
    })
    .then(function (code) {
      if (code) return;
      return db['users.code'].insert({
        user: userId,
        modules: { main: '' },  /* empty script — player will upload their own */
        branch: 'default',
        activeWorld: true,
        activeSim: true,
      });
    })

    /* Step 3: initialise the player's memory blob in Redis.
     * The engine expects this key to exist; an empty object is the correct default. */
    .then(function () {
      return env.set('scrUserMemory:' + userId, '{}');
    })

    /* Step 4: set the login password via screepsmod-auth.
     * This hashes the password and writes `password` + `salt` onto the user record. */
    .then(function () {
      return setPassword(USERNAME, PASSWORD);
    })

    /* Step 5: place a spawn for the user if they aren't already in a room. */
    .then(function () {
      return db['rooms.objects'].findOne({ type: 'spawn', user: userId });
    })
    .then(function (existingSpawn) {
      if (existingSpawn) {
        print('User already spawned in ' + existingSpawn.room);
        return;
      }

      /* Find a random room whose controller is still at level 0 (unowned). */
      return db['rooms.objects'].find({ type: 'controller', level: 0 })
        .then(function (controllers) {
          if (!controllers.length) throw new Error('No unowned rooms available');
          var ctrl = controllers[Math.floor(Math.random() * controllers.length)];
          var room = ctrl.room;

          /* Load the room's terrain string: 2500 chars, one per tile in row-major
           * order (index = y*50 + x).  Each char is a decimal digit where bit 0
           * means wall (1 = wall, 0 = plain/swamp). */
          return db['rooms.terrain'].findOne({ room: room })
            .then(function (terrainObj) {
              var terrain = terrainObj.terrain;

              function isWalkable(x, y) {
                /* Leave a 2-tile border clear of room exits. */
                if (x < 2 || x > 47 || y < 2 || y > 47) return false;
                return (parseInt(terrain[y * 50 + x]) & 1) === 0; /* bit 0 = wall */
              }

              /* Spiral outward from room centre (25, 25) to find the nearest
               * walkable tile.  r is the Chebyshev-distance shell being scanned;
               * we only visit the perimeter of each shell (the `continue` skips
               * interior tiles) so each shell is checked before expanding. */
              var spawnX = -1, spawnY = -1;
              for (var r = 0; r <= 24 && spawnX === -1; r++) {
                for (var dx = -r; dx <= r && spawnX === -1; dx++) {
                  for (var dy = -r; dy <= r && spawnX === -1; dy++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    var x = 25 + dx, y = 25 + dy;
                    if (isWalkable(x, y)) { spawnX = x; spawnY = y; }
                  }
                }
              }
              if (spawnX === -1) throw new Error('No walkable tile found in ' + room);

              print('Spawning ' + USERNAME + ' in room ' + room + ' at (' + spawnX + ', ' + spawnY + ')');

              /* Claim the controller at RCL 1 with a generous downgrade timer so
               * the player has time to start upgrading before losing ownership. */
              return db['rooms.objects'].update({ _id: ctrl._id }, {
                $set: {
                  user: userId,
                  level: 1,
                  progress: 0,
                  downgradeTime: 20000,   /* ticks until controller downgrades */
                  safeMode: 20000,        /* ticks of safe mode remaining */
                  safeModeAvailable: 1,
                }
              }).then(function () {
                /* Insert the spawn structure.  300 energy matches the amount a
                 * freshly-placed spawn has in vanilla Screeps. */
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
              }).then(function () {
                /* Register the room on the user record so the engine includes
                 * it in their CPU scheduling and room-update loops. */
                return db['users'].update({ _id: userId }, { $set: { rooms: [room] } });
              }).then(function () {
                print('Done.');
              });
            });
        });
    });
})()
