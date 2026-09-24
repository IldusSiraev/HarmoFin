import * as path from 'node:path';

try {
  process.loadEnvFile(path.resolve(__dirname, '..', '.env'));
} catch {
  // No .env file (e.g. CI, where these vars are set directly on the job).
}

export const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
export const webBaseUrl = process.env.WEB_BASE_URL ?? webOrigin;
export const apiOrigin = process.env.API_URL ?? 'http://localhost:3001';
export const apiPort = process.env.API_PORT ?? '3001';
const mailpitPort = process.env.MAILPIT_PORT ?? '8025';

export const apiV1 = `${apiOrigin}/api/v1`;
export const mailpitOrigin = `http://localhost:${mailpitPort}`;
