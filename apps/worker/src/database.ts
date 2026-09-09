import { PrismaClient } from '@prisma/client';

import type { WorkerConfig } from './config.js';

export function createWorkerDatabase(config: WorkerConfig): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
}
