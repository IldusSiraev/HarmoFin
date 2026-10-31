import { Prisma } from '@prisma/client';

import { loadWorkerConfig } from './config.js';
import { WorkerHealthServer } from './health-server.js';
import { shutdownWorker } from './lifecycle.js';
import { createWorkerLogger } from './logger.js';
import { createWorkerDatabase } from './database.js';
import { JobRunner } from './job-runner.js';
import { WorkerJobRepository } from './job.repository.js';
import { createWorkerErrorReporter, MetricsRegistry } from './observability/observability.js';
import { PlanOccurrenceHandler } from './plan-occurrence.handler.js';
import { NotificationRuleHandler } from './notification.handler.js';
import { CalendarReminderHandler } from './calendar-reminder.handler.js';
import { AccountPurgeHandler } from './account-purge.handler.js';
import { DeliverNotificationsHandler } from './delivery/deliver.handler.js';
import { DeliveryRepository } from './delivery/delivery.repository.js';
import { SmtpMailer } from './mail/mailer.js';
import { WorkerRuntime } from './runtime.js';

const config = loadWorkerConfig(process.env);
const database = createWorkerDatabase(config);
const metrics = new MetricsRegistry({
  service: 'worker',
  environment: config.nodeEnv,
  releaseSha: config.releaseSha,
});
const errorReporter = createWorkerErrorReporter(config.errorReportingEndpoint);
const logger = createWorkerLogger(config);
const mailHandlers = config.mail
  ? {
      DELIVER_NOTIFICATIONS: new DeliverNotificationsHandler(
        database,
        new DeliveryRepository(database),
        new SmtpMailer(config.mail),
        config.mail.webBaseUrl,
        {
          onOutcome: (kind, outcome) => metrics.recordDelivery(kind, outcome),
          onFailure: (failure) => {
            logger.deliveryFailure(failure);
            void errorReporter.report(new Error('Letter delivery failed'), {
              errorName: failure.errorName,
            });
          },
        },
      ),
    }
  : {};
if (!config.mail) logger.mailDisabled();
const runner = new JobRunner(
  new WorkerJobRepository(database),
  {
    MATERIALIZE_PLAN_OCCURRENCES: new PlanOccurrenceHandler(database),
    EVALUATE_BUDGET_NOTIFICATIONS: new NotificationRuleHandler(database),
    EVALUATE_CALENDAR_REMINDERS: new CalendarReminderHandler(database, (failure) => {
      logger.calendarReminderFailure(failure);
      void errorReporter.report(new Error('Calendar reminder failed'), {
        errorName: failure.errorName,
      });
    }),
    PURGE_DELETED_ACCOUNTS: new AccountPurgeHandler(database, (failure) => {
      logger.purgeFailure(failure);
      void errorReporter.report(new Error('Account purge failed'), {
        errorName: failure.errorName,
      });
    }),
    ...mailHandlers,
  },
  {
    pollIntervalMs: config.pollIntervalMs,
    concurrency: config.concurrency,
    leaseSeconds: config.leaseSeconds,
    metrics: {
      recordPoll: (outcome) => metrics.recordPoll(outcome),
      recordJob: (jobType, outcome) => {
        metrics.recordJob(jobType, outcome);
        logger.jobOutcome({ jobType, outcome });
        if (outcome === 'failed') {
          void errorReporter.report(new Error('Worker job failed'), { jobType, outcome });
        }
      },
    },
  },
);
const runtime = new WorkerRuntime(logger, runner);
metrics.setProcessHealth(1);
const healthServer = new WorkerHealthServer({
  runtime,
  databaseHealth: {
    async check(): Promise<void> {
      await database.$queryRaw(Prisma.sql`SELECT 1`);
    },
  },
  host: config.healthHost,
  port: config.healthPort,
  metrics,
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
