import { z } from 'zod';

const postgresUrl = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === 'postgres:' || protocol === 'postgresql:';
      } catch {
        return false;
      }
    },
    { message: 'must be a PostgreSQL URL' },
  );

const httpUrl = z.url().refine(
  (value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  },
  { message: 'must be an HTTP(S) URL' },
);
const optionalHttpUrl = z
  .literal('')
  .transform(() => undefined)
  .or(httpUrl.optional());

const optionalNonEmpty = z
  .literal('')
  .transform(() => undefined)
  .or(z.string().min(1).optional());

const workerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: postgresUrl,
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WORKER_HEALTH_HOST: z.enum(['0.0.0.0', '127.0.0.1']).default('127.0.0.1'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
  RELEASE_SHA: z.string().min(1).default('dev'),
  ERROR_REPORTING_ENDPOINT: optionalHttpUrl,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalHttpUrl,
  SMTP_HOST: optionalNonEmpty,
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  SMTP_USER: optionalNonEmpty,
  SMTP_PASSWORD: optionalNonEmpty,
  MAIL_FROM: optionalNonEmpty,
  WEB_BASE_URL: optionalHttpUrl,
});

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface WorkerMailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPassword?: string;
  from: string;
  webBaseUrl: string;
}

export interface WorkerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  pollIntervalMs: number;
  concurrency: number;
  leaseSeconds: number;
  logLevel: LogLevel;
  healthHost: '0.0.0.0' | '127.0.0.1';
  healthPort: number;
  releaseSha: string;
  errorReportingEndpoint: string | undefined;
  otelExporterOtlpEndpoint: string | undefined;
  mail: WorkerMailConfig | undefined;
}

export function loadWorkerConfig(input: NodeJS.ProcessEnv): WorkerConfig {
  const result = workerEnvironmentSchema.safeParse(input);

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(
      ', ',
    );
    throw new Error(`Invalid worker configuration: ${fields}`);
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    databaseUrl: result.data.DATABASE_URL,
    pollIntervalMs: result.data.WORKER_POLL_INTERVAL_MS,
    concurrency: result.data.WORKER_CONCURRENCY,
    leaseSeconds: result.data.WORKER_LEASE_SECONDS,
    logLevel: result.data.LOG_LEVEL,
    healthHost: result.data.WORKER_HEALTH_HOST,
    healthPort: result.data.WORKER_HEALTH_PORT,
    releaseSha: result.data.RELEASE_SHA,
    errorReportingEndpoint: result.data.ERROR_REPORTING_ENDPOINT,
    otelExporterOtlpEndpoint: result.data.OTEL_EXPORTER_OTLP_ENDPOINT,
    mail: mailConfig(result.data),
  };
}

/** Mail is optional: without SMTP_HOST the worker skips the delivery and digest jobs entirely. */
function mailConfig(data: z.infer<typeof workerEnvironmentSchema>): WorkerMailConfig | undefined {
  if (!data.SMTP_HOST) return undefined;
  const missing = [
    data.SMTP_PORT ? null : 'SMTP_PORT',
    data.MAIL_FROM ? null : 'MAIL_FROM',
    data.WEB_BASE_URL ? null : 'WEB_BASE_URL',
    Boolean(data.SMTP_USER) === Boolean(data.SMTP_PASSWORD) ? null : 'SMTP_USER, SMTP_PASSWORD',
  ].filter((item): item is string => item !== null);
  if (missing.length > 0) throw new Error(`Invalid worker configuration: ${missing.join(', ')}`);
  return {
    smtpHost: data.SMTP_HOST,
    smtpPort: data.SMTP_PORT!,
    ...(data.SMTP_USER ? { smtpUser: data.SMTP_USER, smtpPassword: data.SMTP_PASSWORD! } : {}),
    from: data.MAIL_FROM!,
    webBaseUrl: data.WEB_BASE_URL!,
  };
}
