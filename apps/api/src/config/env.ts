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

const httpUrl = z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
  message: 'must be an HTTP(S) URL',
});

const apiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: postgresUrl,
  WEB_ORIGIN: httpUrl.default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AUTH_TOKEN_HASH_SECRET: z.string().min(32),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1),
  WEB_BASE_URL: httpUrl,
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_RECOVERY_MAX: z.coerce.number().int().positive().default(5),
});

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface ApiConfig {
  nodeEnv: 'development' | 'test' | 'production';
  apiPort: number;
  databaseUrl: string;
  webOrigin: string;
  logLevel: LogLevel;
  auth: {
    tokenHashSecret: string;
    idleTimeoutSeconds: number;
    absoluteTimeoutSeconds: number;
    recoveryTtlSeconds: number;
    cookieName: string;
  };
  mail: {
    smtpHost: string;
    smtpPort: number;
    smtpUser?: string;
    smtpPassword?: string;
    from: string;
    webBaseUrl: string;
  };
  rateLimit: {
    windowSeconds: number;
    loginMax: number;
    recoveryMax: number;
  };
}

export function loadApiConfig(input: NodeJS.ProcessEnv): ApiConfig {
  const result = apiEnvironmentSchema.safeParse(input);

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(
      ', ',
    );
    throw new Error(`Invalid API configuration: ${fields}`);
  }

  const environment = result.data;
  if (
    environment.NODE_ENV === 'production' &&
    environment.AUTH_TOKEN_HASH_SECRET === 'local-only-change-this-secret-32-bytes-minimum'
  ) {
    throw new Error('Invalid API configuration: AUTH_TOKEN_HASH_SECRET');
  }

  if (
    environment.NODE_ENV === 'production' &&
    Boolean(environment.SMTP_USER) !== Boolean(environment.SMTP_PASSWORD)
  ) {
    throw new Error('Invalid API configuration: SMTP_USER, SMTP_PASSWORD');
  }

  return {
    nodeEnv: environment.NODE_ENV,
    apiPort: environment.API_PORT,
    databaseUrl: environment.DATABASE_URL,
    webOrigin: environment.WEB_ORIGIN,
    logLevel: environment.LOG_LEVEL,
    auth: {
      tokenHashSecret: environment.AUTH_TOKEN_HASH_SECRET,
      idleTimeoutSeconds: 2_592_000,
      absoluteTimeoutSeconds: 7_776_000,
      recoveryTtlSeconds: 3_600,
      cookieName: environment.NODE_ENV === 'production' ? '__Host-harmofin_session' : 'harmofin_session',
    },
    mail: {
      smtpHost: environment.SMTP_HOST,
      smtpPort: environment.SMTP_PORT,
      ...(environment.SMTP_USER ? { smtpUser: environment.SMTP_USER } : {}),
      ...(environment.SMTP_PASSWORD ? { smtpPassword: environment.SMTP_PASSWORD } : {}),
      from: environment.MAIL_FROM,
      webBaseUrl: environment.WEB_BASE_URL,
    },
    rateLimit: {
      windowSeconds: environment.RATE_LIMIT_WINDOW_SECONDS,
      loginMax: environment.RATE_LIMIT_LOGIN_MAX,
      recoveryMax: environment.RATE_LIMIT_RECOVERY_MAX,
    },
  };
}
