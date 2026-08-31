import { z } from 'zod';

const workerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface WorkerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
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
    logLevel: result.data.LOG_LEVEL,
  };
}
