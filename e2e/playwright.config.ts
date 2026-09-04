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
  timeout: 30_000,
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
