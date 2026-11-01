import { defineConfig } from '@playwright/test';
import { apiOrigin, apiPort, webBaseUrl, webOrigin } from './env';

const testEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
  WEB_ORIGIN: webOrigin,
  WEB_BASE_URL: webBaseUrl,
  API_URL: apiOrigin,
  API_PORT: apiPort,
  AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  MAIL_FROM: 'no-reply@harmofin.test',
  TELEGRAM_BOT_TOKEN: '123456:e2e-only-token',
  TELEGRAM_BOT_USERNAME: 'harmofin_e2e_bot',
  TELEGRAM_WEBHOOK_SECRET: 'e2e-only-webhook-secret-with-32-chars',
  // Closed port: the bot's replies fail fast and never leave the CI runner.
  TELEGRAM_API_BASE_URL: 'http://127.0.0.1:9',
};

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Runs before the webServer entries: kill stale (unresponsive) dev-server
  // listeners left by previous local runs so the fresh servers can bind.
  globalSetup: './preflight',
  timeout: 60_000,
  // These specs run against a dev server, so the first visit to a route pays
  // for compilation on demand; a longer wait costs nothing on a passing run.
  expect: { timeout: 20_000 },
  // These specs share one dev server, one database, and one IP-rate-limited API
  // process — registration's real Argon2id hashing and the auth-recovery rate
  // limiter both serialize badly under concurrent workers, causing sporadic
  // timeouts that don't reproduce serially. Force a single worker everywhere
  // instead of relying on Playwright's core-count default, which only happened
  // to land on 1 in CI because that runner has 2 cores.
  workers: 1,
  use: {
    baseURL: webBaseUrl,
    browserName: 'chromium',
  },
  webServer: [
    {
      command: 'pnpm --filter @harmofin/api dev',
      url: `${apiOrigin}/api/v1/health/live`,
      env: { ...process.env, ...testEnvironment },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @harmofin/web dev',
      url: `${webOrigin}/register`,
      env: { ...process.env, ...testEnvironment },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
