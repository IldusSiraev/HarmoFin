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

const workerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: postgresUrl,
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WORKER_HEALTH_HOST: z.enum(['0.0.0.0', '127.0.0.1']).default('127.0.0.1'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
});

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface WorkerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  pollIntervalMs: number;
  concurrency: number;
  leaseSeconds: number;
  logLevel: LogLevel;
  healthHost: '0.0.0.0' | '127.0.0.1';
  healthPort: number;
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
  };
}
