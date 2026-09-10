import pino, { type Logger } from 'pino';

import type { WorkerConfig } from './config.js';
import type { WorkerLogger } from './runtime.js';

export interface WorkerEventLogger extends WorkerLogger {
  jobOutcome(fields: { jobType: string; outcome: 'completed' | 'failed' | 'retried' }): void;
}

export function createWorkerLogger(config: WorkerConfig): WorkerEventLogger {
  return new PinoWorkerLogger(
    pino({
      level: config.logLevel,
      base: { service: 'worker', environment: config.nodeEnv, release: config.releaseSha },
      redact: [
        'password',
        'cookie',
        'authorization',
        'databaseUrl',
        'databaseURL',
        'session',
        'sessionToken',
        'token',
        'comment',
        'amount',
        'amountMinor',
        'jobPayload',
        'financialPayload',
      ],
    }),
  );
}

class PinoWorkerLogger implements WorkerEventLogger {
  constructor(private readonly logger: Logger) {}

  started(): void {
    this.logger.info({ event: 'worker_started' }, 'Worker started');
  }

  stopped(signal: NodeJS.Signals): void {
    this.logger.info({ event: 'worker_stopped', signal }, 'Worker stopped');
  }

  jobOutcome(fields: { jobType: string; outcome: 'completed' | 'failed' | 'retried' }): void {
    this.logger.info({ event: 'job_outcome', ...fields }, 'Job outcome');
  }
}
