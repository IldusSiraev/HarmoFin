import type { LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

import type { ApiConfig } from '../../config/env.js';

export interface ApiEventLogger {
  started(port: number): void;
  requestOutcome(fields: {
    requestId: string;
    method: string;
    route: string;
    status: number;
    durationMs: number;
    errorCode?: string;
  }): void;
}

export function createApiLogger(config: ApiConfig): LoggerService & ApiEventLogger {
  const logger = pino({
    level: config.logLevel,
    base: { service: 'api', environment: config.nodeEnv, release: config.releaseSha },
    redact: [
      'password',
      'cookie',
      'cookies',
      'authorization',
      'databaseUrl',
      'databaseURL',
      'session',
      'sessionToken',
      'token',
      'comment',
      'amount',
      'amountMinor',
      'financialPayload',
      'req.headers.cookie',
      'req.headers.authorization',
      'request.headers.cookie',
      'request.headers.authorization',
    ],
  });

  return new SafeApiLogger(logger);
}

class SafeApiLogger implements LoggerService, ApiEventLogger {
  constructor(private readonly logger: Logger) {}

  log(_message: unknown, context?: string): void {
    this.logger.info({ event: 'application_log', context }, 'Application event');
  }

  error(_message: unknown, _trace?: string, context?: string): void {
    this.logger.error({ event: 'application_error', context }, 'Application error');
  }

  warn(_message: unknown, context?: string): void {
    this.logger.warn({ event: 'application_warning', context }, 'Application warning');
  }

  debug(_message: unknown, context?: string): void {
    this.logger.debug({ event: 'application_debug', context }, 'Application debug event');
  }

  verbose(_message: unknown, context?: string): void {
    this.logger.trace({ event: 'application_trace', context }, 'Application trace event');
  }

  fatal(_message: unknown, context?: string): void {
    this.logger.fatal({ event: 'application_fatal', context }, 'Application fatal event');
  }

  started(port: number): void {
    this.logger.info({ event: 'api_started', port }, 'API started');
  }

  requestOutcome(fields: {
    requestId: string;
    method: string;
    route: string;
    status: number;
    durationMs: number;
    errorCode?: string;
  }): void {
    this.logger.info({ event: 'request_outcome', ...fields }, 'Request completed');
  }
}
