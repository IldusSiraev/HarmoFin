import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runSeed } from '../../apps/api/src/database/seed.js';

const environmentPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(environmentPath)) {
  process.loadEnvFile(environmentPath);
}

void runSeed(process.env).catch((error: unknown) => {
  process.exitCode = 1;
  throw error;
});
