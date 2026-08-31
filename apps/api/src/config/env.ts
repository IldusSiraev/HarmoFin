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

const apiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: postgresUrl,
  WEB_ORIGIN: z
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
      message: 'must be an HTTP(S) URL',
    })
    .default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface ApiConfig {
  nodeEnv: 'development' | 'test' | 'production';
  apiPort: number;
  databaseUrl: string;
  webOrigin: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

export function loadApiConfig(input: NodeJS.ProcessEnv): ApiConfig {
  const result = apiEnvironmentSchema.safeParse(input);

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(
      ', ',
    );
    throw new Error(`Invalid API configuration: ${fields}`);
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    apiPort: result.data.API_PORT,
    databaseUrl: result.data.DATABASE_URL,
    webOrigin: result.data.WEB_ORIGIN,
    logLevel: result.data.LOG_LEVEL,
  };
}
