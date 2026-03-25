#!/bin/sh
set -e
envsubst '${STATS_KEY}' < /screeps/config.yml.template > /screeps/config.yml
exec "$@"
