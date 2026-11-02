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
const optionalNonEmptyString = z
  .literal('')
  .transform(() => undefined)
  .or(z.string().min(1).optional());

const apiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: postgresUrl,
  WEB_ORIGIN: httpUrl.default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  RELEASE_SHA: z.string().min(1).default('dev'),
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),
  ERROR_REPORTING_ENDPOINT: optionalHttpUrl,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalHttpUrl,
  AUTH_TOKEN_HASH_SECRET: z.string().min(32),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
  SMTP_USER: optionalNonEmptyString,
  SMTP_PASSWORD: optionalNonEmptyString,
  MAIL_FROM: z.string().min(1),
  WEB_BASE_URL: httpUrl,
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_RECOVERY_MAX: z.coerce.number().int().positive().default(5),
  TELEGRAM_BOT_TOKEN: optionalNonEmptyString,
  TELEGRAM_BOT_USERNAME: z
    .literal('')
    .transform(() => undefined)
    .or(
      z
        .string()
        .regex(/^[A-Za-z0-9_]{5,32}$/)
        .optional(),
    ),
  TELEGRAM_WEBHOOK_SECRET: z
    .literal('')
    .transform(() => undefined)
    .or(
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{32,256}$/)
        .optional(),
    ),
  TELEGRAM_API_BASE_URL: httpUrl.default('https://api.telegram.org'),
  // Public VAPID key only: the private key lives in the worker and never reaches the API.
  VAPID_PUBLIC_KEY: z
    .literal('')
    .transform(() => undefined)
    .or(
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{87}$/)
        .refine((value) => Buffer.from(value, 'base64url')[0] === 4, {
          message: 'must be an uncompressed P-256 public key',
        })
        .optional(),
    ),
});

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface ApiTelegramConfig {
  botToken: string;
  botUsername: string;
  webhookSecret: string;
  apiBaseUrl: string;
}

export interface ApiConfig {
  nodeEnv: 'development' | 'test' | 'production';
  apiPort: number;
  databaseUrl: string;
  webOrigin: string;
  logLevel: LogLevel;
  trustProxy: boolean;
  releaseSha: string;
  appVersion: string;
  errorReportingEndpoint?: string;
  otelExporterOtlpEndpoint?: string;
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
  /** Present only when the bot token, username and webhook secret are all set. */
  telegram?: ApiTelegramConfig;
  /** Present only when VAPID_PUBLIC_KEY is set; the client gets this key from the API at runtime. */
  push?: { vapidPublicKey: string };
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

  if (environment.NODE_ENV === 'production' && environment.TRUST_PROXY !== 'true') {
    throw new Error('Invalid API configuration: TRUST_PROXY');
  }

  if (
    environment.NODE_ENV === 'production' &&
    Boolean(environment.SMTP_USER) !== Boolean(environment.SMTP_PASSWORD)
  ) {
    throw new Error('Invalid API configuration: SMTP_USER, SMTP_PASSWORD');
  }

  const telegramValues = [
    ['TELEGRAM_BOT_TOKEN', environment.TELEGRAM_BOT_TOKEN],
    ['TELEGRAM_BOT_USERNAME', environment.TELEGRAM_BOT_USERNAME],
    ['TELEGRAM_WEBHOOK_SECRET', environment.TELEGRAM_WEBHOOK_SECRET],
  ] as const;
  const missingTelegram = telegramValues.filter(([, value]) => !value).map(([name]) => name);
  if (missingTelegram.length > 0 && missingTelegram.length < telegramValues.length) {
    throw new Error(`Invalid API configuration: ${missingTelegram.join(', ')}`);
  }

  return {
    nodeEnv: environment.NODE_ENV,
    apiPort: environment.API_PORT,
    databaseUrl: environment.DATABASE_URL,
    webOrigin: environment.WEB_ORIGIN,
    logLevel: environment.LOG_LEVEL,
    trustProxy: environment.TRUST_PROXY === 'true',
    releaseSha: environment.RELEASE_SHA,
    appVersion: environment.APP_VERSION,
    ...(environment.ERROR_REPORTING_ENDPOINT
      ? { errorReportingEndpoint: environment.ERROR_REPORTING_ENDPOINT }
      : {}),
    ...(environment.OTEL_EXPORTER_OTLP_ENDPOINT
      ? { otelExporterOtlpEndpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT }
      : {}),
    auth: {
      tokenHashSecret: environment.AUTH_TOKEN_HASH_SECRET,
      idleTimeoutSeconds: 2_592_000,
      absoluteTimeoutSeconds: 7_776_000,
      recoveryTtlSeconds: 3_600,
      cookieName:
        environment.NODE_ENV === 'production' ? '__Host-harmofin_session' : 'harmofin_session',
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
    ...(missingTelegram.length === 0
      ? {
          telegram: {
            botToken: environment.TELEGRAM_BOT_TOKEN!,
            botUsername: environment.TELEGRAM_BOT_USERNAME!,
            webhookSecret: environment.TELEGRAM_WEBHOOK_SECRET!,
            apiBaseUrl: environment.TELEGRAM_API_BASE_URL.replace(/\/+$/, ''),
          },
        }
      : {}),
    ...(environment.VAPID_PUBLIC_KEY
      ? { push: { vapidPublicKey: environment.VAPID_PUBLIC_KEY } }
      : {}),
  };
}
