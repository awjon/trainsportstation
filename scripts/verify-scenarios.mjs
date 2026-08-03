// Standalone content gate (docs/70 G4) — validates every shipped scenario and replays its
// reference solution to 3 stars with a fair time target:
//
//   npm run verify:scenarios
//
// The checks live in TypeScript (src/scenarios/verify.ts) and are exercised by
// src/scenarios/content.test.ts, so this script runs that suite through vitest rather than
// duplicating the logic — one implementation, one source of truth. Exits non-zero on failure.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

console.log('Verifying shipped scenarios (validate + reference solution → 3★)…\n');

const run = spawnSync('npx', ['vitest', 'run', 'src/scenarios/content.test.ts', '--reporter=verbose'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(run.status ?? 1);
