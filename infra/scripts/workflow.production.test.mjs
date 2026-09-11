import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../..', import.meta.url);

async function readWorkflow(name) {
  return readFile(new URL(`.github/workflows/${name}`, root), 'utf8');
}

test('production workflow requires manual dispatch with required inputs', async () => {
  const workflow = await readWorkflow('deploy-production.yml');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /image_tag:/);
  assert.match(workflow, /staging_evidence:/);
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
  assert.match(workflow, /test -n.*staging_evidence/i);
  assert.match(workflow, /test -n.*backup_evidence/i);
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

  assert.match(workflow, /staging_evidence=/);
  assert.match(workflow, /migration_compatibility=/);
  assert.match(workflow, /backup_evidence=/);
  assert.match(workflow, /environment=production/);
  assert.match(workflow, /retention-days: 90/);
});
