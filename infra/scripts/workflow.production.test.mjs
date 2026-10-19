import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runBlocks } from './workflow-test-helpers.mjs';

const root = new URL('../..', import.meta.url);

async function readWorkflow(name) {
  return readFile(new URL(`.github/workflows/${name}`, root), 'utf8');
}

test('production workflow requires manual dispatch with required inputs', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release:/);
  assert.doesNotMatch(workflow, /image_tag:/);
  assert.match(workflow, /migration_compatibility:/);
  assert.match(workflow, /backup_evidence:/);
  assert.match(workflow, /required:\s*true/);
});

test('production workflow is environment scoped', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /environment:\s*\n\s*name:\s*production/);
  assert.doesNotMatch(workflow, /environment:\s*\n\s*name:\s*staging/);
});

test('production workflow validates SHA format and evidence', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /grep -Eq '\^\[0-9a-f\]\{7,40\}\$'/);
  assert.match(workflow, /test -n.*BACKUP_EVIDENCE/);
});

test('production workflow resolves a release version to its tagged SHA', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /source infra\/scripts\/release\.sh/);
  assert.match(workflow, /resolve_release "\$RELEASE_INPUT"/);
  assert.match(workflow, /RELEASE_INPUT:\s*\$\{\{\s*inputs\.release\s*\}\}/);
  assert.match(workflow, /sha:\s*\$\{\{\s*steps\.resolve\.outputs\.sha\s*\}\}/);
  assert.match(workflow, /RELEASE_SHA:\s*\$\{\{\s*needs\.validate\.outputs\.sha\s*\}\}/);
  assert.match(workflow, /ref:\s*\$\{\{\s*needs\.validate\.outputs\.sha\s*\}\}/);
});

test('production workflow never interpolates inputs into shell scripts', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  for (const block of runBlocks(workflow)) {
    assert.doesNotMatch(block, /\$\{\{\s*inputs\./);
  }
});

test('production workflow does not trigger on push or pull_request', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.doesNotMatch(workflow, /\bon:\s*\n\s*(push|pull_request):/);
  assert.doesNotMatch(workflow, /workflow_run:/);
});

test('production workflow uses production secrets and invokes deploy script', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /PRODUCTION_SSH_HOST/);
  assert.match(workflow, /PRODUCTION_ENV_FILE/);
  assert.match(workflow, /\.env\.production/);
  assert.match(workflow, /infra\/scripts\/deploy\.sh/);
  assert.match(workflow, /set -a/);
});

test('production workflow records all evidence in metadata', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /version=%s/);
  assert.match(workflow, /migration_compatibility=/);
  assert.match(workflow, /backup_evidence=/);
  assert.match(workflow, /environment=production/);
  assert.match(workflow, /retention-days: 90/);
});
