#!/bin/sh
set -e
envsubst '${STATS_KEY}' < /screeps/config.yml.template > /screeps/config.yml
rm -f /screeps/storage.sock
cd /screeps/mods && npm install /screepsmod-visualizer /screepsmod-picklenet 2>/dev/null || true
exec "$@"
