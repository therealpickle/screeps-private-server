// Created with Claude Code (claude.ai/code)

module.exports.loop = function () {
    const spawn = Game.spawns['Spawn1'];
    if (!spawn) return;

    // Spawn a harvester whenever none are alive
    if (Object.keys(Game.creeps).length === 0) {
        spawn.spawnCreep([WORK, CARRY, MOVE], 'harvester', { memory: { harvesting: true } });
    }

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];

        // Toggle between harvesting and delivering
        if (creep.memory.harvesting && creep.store.getFreeCapacity() === 0) {
            creep.memory.harvesting = false;
        }
        if (!creep.memory.harvesting && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.harvesting = true;
        }

        if (creep.memory.harvesting) {
            const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
            if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source);
            }
        } else {
            if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(spawn);
            }
        }
    }
};

// Created with Claude Code (claude.ai/code)
