#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SCREEPS_YML = path.join(__dirname, '.screeps.yml');

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

        const yml = [
            `servers:`,
            `  ${name}:`,
            `    host: ${address}`,
            `    port: 21025`,
            `    http: true`,
            `    username: ${username}`,
            `    password: ${password}`,
            `    branch: default`,
            '',
        ].join('\n');

        fs.writeFileSync(SCREEPS_YML, yml);
        console.log(`Wrote .screeps.yml for server '${name}'`);
    },
};

const [,, command, ...rest] = process.argv;

if (!command || !commands[command]) {
    console.error(`Unknown command: ${command || '(none)'}`);
    console.error(`Available commands: ${Object.keys(commands).join(', ')}`);
    process.exit(1);
}

commands[command](parseArgs(rest));
