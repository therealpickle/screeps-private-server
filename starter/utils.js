#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SCREEPS_YML = path.join(__dirname, '.screeps.yml');

function readConfig(filePath) {
    if (!fs.existsSync(filePath)) return { servers: {} };
    const config = { servers: {} };
    let currentServer = null;
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
        const serverMatch = line.match(/^  (\S+):$/);
        const propMatch   = line.match(/^    (\w+): (.+)$/);
        if (serverMatch) {
            currentServer = serverMatch[1];
            config.servers[currentServer] = {};
        } else if (propMatch && currentServer) {
            const v = propMatch[2];
            config.servers[currentServer][propMatch[1]] =
                v === 'true' ? true : v === 'false' ? false : isNaN(v) ? v : Number(v);
        }
    }
    return config;
}

function writeConfig(filePath, config) {
    const lines = ['servers:'];
    for (const [name, server] of Object.entries(config.servers)) {
        lines.push(`  ${name}:`);
        for (const [key, val] of Object.entries(server)) {
            lines.push(`    ${key}: ${val}`);
        }
    }
    lines.push('');
    fs.writeFileSync(filePath, lines.join('\n'));
}

// Parse --key=value or --key value style args
function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const match = argv[i].match(/^--([^=]+)=(.*)$/);
        if (match) {
            args[match[1]] = match[2];
        } else if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
            args[argv[i].slice(2)] = argv[++i];
        }
    }
    return args;
}

const commands = {
    configure(args) {
        const { address, username, password, name = 'private' } = args;
        const missing = ['address', 'username', 'password'].filter(k => !args[k]);
        if (missing.length) {
            console.error(`Missing required arguments: ${missing.map(k => '--' + k).join(', ')}`);
            console.error('Usage: node utils.js configure --address=<addr> --username=<user> --password=<pass> [--name=private]');
            process.exit(1);
        }

        const config = readConfig(SCREEPS_YML);
        const existing = config.servers[name] || {};
        const isNew = !config.servers[name];

        config.servers[name] = Object.assign(existing, {
            host: address,
            port: 21025,
            http: true,
            username,
            password,
            branch: existing.branch || 'default',
        });

        writeConfig(SCREEPS_YML, config);
        console.log(`${isNew ? 'Added' : 'Updated'} server '${name}' in .screeps.yml`);
    },
};

const [,, command, ...rest] = process.argv;

if (!command || !commands[command]) {
    console.error(`Unknown command: ${command || '(none)'}`);
    console.error(`Available commands: ${Object.keys(commands).join(', ')}`);
    process.exit(1);
}

commands[command](parseArgs(rest));
