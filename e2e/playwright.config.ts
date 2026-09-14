import { defineConfig } from '@playwright/test';

const testEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
  WEB_ORIGIN: 'http://localhost:3000',
  WEB_BASE_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  API_PORT: '3001',
  AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  MAIL_FROM: 'no-reply@harmofin.test',
};

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
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
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
  },
  webServer: [
    {
      command: 'pnpm --filter @harmofin/api dev',
      url: 'http://localhost:3001/api/v1/health/live',
      env: { ...process.env, ...testEnvironment },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @harmofin/web dev',
      url: 'http://localhost:3000/register',
      env: { ...process.env, ...testEnvironment },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
