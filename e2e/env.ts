import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const webBase = process.env.WEB_ORIGIN ?? process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const apiOrigin = process.env.API_URL ?? 'http://localhost:3001';
const mailpitPort = process.env.MAILPIT_PORT ?? '8025';

export { webBase };
export const apiV1 = `${apiOrigin}/api/v1`;
export const mailpitOrigin = `http://localhost:${mailpitPort}`;
