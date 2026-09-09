import { Prisma } from '@prisma/client';

import { loadWorkerConfig } from './config.js';
import { WorkerHealthServer } from './health-server.js';
import { shutdownWorker } from './lifecycle.js';
import { createWorkerLogger } from './logger.js';
import { createWorkerDatabase } from './database.js';
import { JobRunner } from './job-runner.js';
import { WorkerJobRepository } from './job.repository.js';
import { PlanOccurrenceHandler } from './plan-occurrence.handler.js';
import { NotificationRuleHandler } from './notification.handler.js';
import { WorkerRuntime } from './runtime.js';

const config = loadWorkerConfig(process.env);
const database = createWorkerDatabase(config);
const runner = new JobRunner(
  new WorkerJobRepository(database),
  {
    MATERIALIZE_PLAN_OCCURRENCES: new PlanOccurrenceHandler(database),
    EVALUATE_BUDGET_NOTIFICATIONS: new NotificationRuleHandler(database),
  },
  {
    pollIntervalMs: config.pollIntervalMs,
    concurrency: config.concurrency,
    leaseSeconds: config.leaseSeconds,
  },
);
const runtime = new WorkerRuntime(createWorkerLogger(config), runner);
const healthServer = new WorkerHealthServer({
  runtime,
  databaseHealth: {
    async check(): Promise<void> {
      await database.$queryRaw(Prisma.sql`SELECT 1`);
    },
  },
  host: config.healthHost,
  port: config.healthPort,
});

await runtime.start();
await healthServer.start();

let shutdown: Promise<void> | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shutdown ??= shutdownWorker(signal, { healthServer, runtime, database });
    void shutdown.then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.exitCode = 1;
      },
    );
  });
}
