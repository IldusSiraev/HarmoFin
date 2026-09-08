import { createWorkerLogger } from './logger.js';
import { loadWorkerConfig } from './config.js';
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

await runtime.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void runtime.stop(signal).then(async () => {
      await database.$disconnect();
      process.exitCode = 0;
    });
  });
}
