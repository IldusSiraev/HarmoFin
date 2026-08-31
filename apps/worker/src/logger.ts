import pino, { type Logger } from 'pino';

import type { WorkerConfig } from './config.js';
import type { WorkerLogger } from './runtime.js';

export function createWorkerLogger(config: WorkerConfig): WorkerLogger {
  return new PinoWorkerLogger(
    pino({
      level: config.logLevel,
      base: { service: 'worker', environment: config.nodeEnv },
    }),
  );
}

class PinoWorkerLogger implements WorkerLogger {
  constructor(private readonly logger: Logger) {}

  started(): void {
    this.logger.info({ event: 'worker_started' }, 'Worker started');
  }

  stopped(signal: NodeJS.Signals): void {
    this.logger.info({ event: 'worker_stopped', signal }, 'Worker stopped');
  }
}
