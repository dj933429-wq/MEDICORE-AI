/**
 * MEDICORE-AI — Isolated Blood Bank Distribution & Request Integrity Real Transaction Runner
 * FILE: tests/blood-bank/blood-bank-distribution-integrity.test.mjs
 *
 * Directs execution to the TypeScript transaction suite under project tsx,
 * preserving consistent module context and emulator environment.
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const tsTestPath = resolve('tests/blood-bank/blood-bank-distribution-integrity.test.ts');

const result = spawnSync('npx', ['tsx', '--env-file=.env.local', tsTestPath], {
  stdio: 'inherit',
  shell: true,
});

if (result.error) {
  console.error('Failed to spawn test runner process:', result.error);
  process.exit(1);
}

if (result.status === null) {
  console.error(`Test runner process terminated abnormally by signal: ${result.signal || 'unknown'}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status);
}

process.exit(0);
