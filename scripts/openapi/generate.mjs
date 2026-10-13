import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sortKeysDeep } from './sort-keys.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = resolve(repoRoot, 'apps/api');
const outputPath = process.argv[2] ?? resolve(repoRoot, 'openapi.json');

const script = `
import 'reflect-metadata';
import { createApiApp } from './src/app.js';
import { loadApiConfig } from './src/config/env.js';

const config = loadApiConfig({
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  AUTH_TOKEN_HASH_SECRET:
    process.env.AUTH_TOKEN_HASH_SECRET ?? 'openapi-generation-secret-with-at-least-32-bytes',
  SMTP_HOST: process.env.SMTP_HOST ?? '127.0.0.1',
  SMTP_PORT: process.env.SMTP_PORT ?? '1025',
  MAIL_FROM: process.env.MAIL_FROM ?? 'no-reply@harmofin.test',
  WEB_BASE_URL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
});
const app = await createApiApp(config);
await app.init();
const server = app.getHttpAdapter().getInstance();
await server.ready();
const response = await server.inject({ method: 'GET', url: '/openapi.json' });
process.stdout.write(response.body, () => process.exit(0));
`;

const result = execFileSync(
  process.execPath,
  ['--import', 'tsx', '--input-type=module', '-e', script],
  {
    cwd: apiRoot,
    encoding: 'utf8',
  },
);

const document = sortKeysDeep(JSON.parse(result));

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);

process.stdout.write(`OpenAPI document written to ${outputPath}\n`);
