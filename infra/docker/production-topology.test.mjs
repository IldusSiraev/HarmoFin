import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../..', import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('production Docker targets run as non-root users', async () => {
  const dockerfile = await readProjectFile('infra/docker/Dockerfile');

  for (const target of ['web', 'api', 'worker', 'migrate']) {
    assert.match(dockerfile, new RegExp(`FROM .+ AS ${target}`));
  }

  assert.match(dockerfile, /USER\s+(?!root\b)\S+/);
  assert.match(dockerfile, /FROM node:24\.20\.0-alpine@sha256:[a-f0-9]{64}/);
});

test('production build prepares Nuxt types without local generated files', async () => {
  const dockerfile = await readProjectFile('infra/docker/Dockerfile');

  assert.match(dockerfile, /pnpm --filter @harmofin\/web exec nuxt prepare && pnpm build/);
});

test('production build deploys workspace dependencies with pnpm legacy mode', async () => {
  const dockerfile = await readProjectFile('infra/docker/Dockerfile');

  assert.match(dockerfile, /pnpm --filter @harmofin\/api --prod --legacy deploy/);
  assert.match(dockerfile, /pnpm --filter @harmofin\/worker --prod --legacy deploy/);
});

test('production Compose exposes ports only through Caddy and has no database service', async () => {
  const compose = await readProjectFile('infra/compose/production.yml');

  assert.match(compose, /^\s*caddy:\s*$/m);
  assert.doesNotMatch(compose, /^\s*postgres:\s*$/m);
  assert.doesNotMatch(compose, /^\s*(web|api|worker|migrate):[\s\S]*?^\s*ports:\s*$/m);
});

test('Docker build context excludes local secrets and artifacts', async () => {
  const dockerignore = await readProjectFile('.dockerignore');

  for (const entry of ['.env', '.env.*', '**/node_modules', '.git']) {
    assert.match(dockerignore, new RegExp(`^${entry.replaceAll('.', '\\.').replaceAll('*', '\\*')}\\/?$`, 'm'));
  }

  assert.doesNotMatch(dockerignore, /^!\.env\.example$/m);
});

test('staging example contains only safe placeholders', async () => {
  const environment = await readProjectFile('infra/env/staging.example');

  assert.match(environment, /^CADDY_IMAGE=<registry-caddy-image>@sha256:<digest>$/m);
  assert.match(environment, /^IMAGE_TAG=<commit-sha>$/m);
  assert.match(environment, /^DATABASE_URL=<provided-at-runtime>$/m);
  assert.doesNotMatch(environment, /postgres(?:ql)?:\/\/[^<\s]/i);
});

test('Caddy routes API through same origin without routing private probes', async () => {
  const caddyfile = await readProjectFile('infra/caddy/Caddyfile');

  assert.match(caddyfile, /handle \/api\/\*/);
  assert.match(caddyfile, /reverse_proxy api:/);
  assert.doesNotMatch(caddyfile, /metrics|worker.*(?:live|ready)|(?:live|ready).*worker/i);
});
