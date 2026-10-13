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
};

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Runs before the webServer entries: kill stale (unresponsive) dev-server
  // listeners left by previous local runs so the fresh servers can bind.
  globalSetup: './preflight',
  // Explicit so CI can upload traces from a known path (see Upload Playwright traces).
  outputDir: './test-results',
  timeout: 60_000,
  // These specs run against a dev server, so the first visit to a route pays
  // for on-demand compilation — the analytics page, which pulls in echarts,
  // regularly needs more than Playwright's default five seconds before its
  // report renders. A longer wait costs nothing on a passing run.
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
    // Temporary diagnostics for the CI-only ERR_ABORTED on the first dev-server visit.
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @harmofin/api dev',
      url: `${apiOrigin}/api/v1/health/live`,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...testEnvironment },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @harmofin/web dev',
      url: `${webOrigin}/register`,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...testEnvironment },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
