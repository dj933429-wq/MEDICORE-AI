/**
 * MEDICORE-AI — Isolated Blood Bank Distribution & Request Integrity Real Transaction Runner
 * FILE: tests/blood-bank/blood-bank-distribution-integrity.test.mjs
 *
 * Directs execution to the TypeScript transaction suite under local tsx,
 * preserving consistent module context and emulator environment.
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const tsTestPath = resolve('tests/blood-bank/blood-bank-distribution-integrity.test.ts');
const tsxCli = 'C:\\Users\\dj933\\AppData\\Local\\npm-cache\\_npx\\fd45a72a545557e9\\node_modules\\tsx\\dist\\cli.mjs';

const result = spawnSync('node', ['--env-file=.env.local', tsxCli, tsTestPath], {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 0);
