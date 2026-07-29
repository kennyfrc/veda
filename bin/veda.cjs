#!/usr/bin/env node
/**
 * veda — npm global-install shim.
 *
 * Resolves the precompiled platform binary (installed via
 * optionalDependencies) and spawns it with inherited stdio so the
 * user gets the real compiled binary, not a JS interpreter. No bun
 * runtime required — node (which ships with npm) is enough.
 *
 * Platform packages: veda-ts-darwin-arm64, veda-ts-darwin-x64,
 * veda-ts-linux-x64, veda-ts-linux-arm64.
 */
'use strict';

const { spawn } = require('child_process');
const { existsSync } = require('fs');

const PLATFORMS = {
  'darwin-arm64': 'veda-ts-darwin-arm64',
  'darwin-x64':   'veda-ts-darwin-x64',
  'linux-x64':    'veda-ts-linux-x64',
  'linux-arm64':  'veda-ts-linux-arm64',
};

const key = process.platform + '-' + process.arch;
const pkg = PLATFORMS[key];

if (!pkg) {
  process.stderr.write('veda: unsupported platform ' + key + '\n');
  process.stderr.write('Supported: ' + Object.keys(PLATFORMS).join(', ') + '\n');
  process.exit(1);
}

// Resolve the binary inside the platform package's bin/ directory.
let binPath;
try {
  binPath = require.resolve(pkg + '/bin/veda');
} catch (e) {
  process.stderr.write('veda: platform package "' + pkg + '" is not installed.\n');
  process.stderr.write('Run: npm install -g ' + pkg + '\n');
  process.exit(1);
}

if (!existsSync(binPath)) {
  process.stderr.write('veda: binary not found at ' + binPath + '\n');
  process.exit(1);
}

const child = spawn(binPath, process.argv.slice(2), { stdio: 'inherit' });
child.on('error', (e) => {
  process.stderr.write('veda: failed to launch binary: ' + e.message + '\n');
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
