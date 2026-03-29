#!/bin/sh
set -e
envsubst '${STATS_KEY}' < /screeps/config.yml.template > /screeps/config.yml
rm -f /screeps/storage.sock

# Patch the storage module to remove a stale socket and retry on EADDRINUSE.
# The launcher restarts the storage subprocess on crash without cleanup, so
# a socket left by a previous crash causes a permanent crash loop without this.
node -e "
const fs = require('fs');
const f = '/screeps/node_modules/@screeps/storage/lib/index.js';
let s = fs.readFileSync(f, 'utf8');
if (!s.includes('EADDRINUSE_PATCH')) {
  s = s.replace(
    \"server.listen(process.env.STORAGE_PORT, process.env.STORAGE_HOST || 'localhost');\",
    \"server.on('error',function(e){if(e.code==='EADDRINUSE'){require('fs').unlink(process.env.STORAGE_PORT,function(){server.listen(process.env.STORAGE_PORT,process.env.STORAGE_HOST||'localhost');});}});/*EADDRINUSE_PATCH*/server.listen(process.env.STORAGE_PORT,process.env.STORAGE_HOST||'localhost');\"
  );
  fs.writeFileSync(f, s);
}
" 2>/dev/null || true

cd /screeps/mods && npm install /screepsmod-visualizer /screepsmod-picklenet 2>/dev/null || true
exec "$@"
