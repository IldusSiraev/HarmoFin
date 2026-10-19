import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runBlocks } from './workflow-test-helpers.mjs';

const root = new URL('../..', import.meta.url);

async function readWorkflow(name) {
  return readFile(new URL(`.github/workflows/${name}`, root), 'utf8');
}

test('publish workflow builds exact SHA images only after main', async () => {
  const workflow = await readWorkflow('publish.yml');

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\[HarmoFin CI\]/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /head_sha/);
  assert.match(workflow, /docker\/build-push-action@[0-9a-f]{40}/);
  assert.match(workflow, /push:\s*true/);
  assert.doesNotMatch(workflow, /:latest/);
});

test('staging workflow is environment scoped and invokes deploy script', async () => {
  const workflow = await readWorkflow('deploy-staging.yml');

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /environment:\s*\n\s*name:\s*staging/);
  assert.match(workflow, /infra\/scripts\/deploy\.sh/);
  assert.match(workflow, /IMAGE_TAG/);
  assert.match(workflow, /\.env\.staging/);
  assert.match(workflow, /set -a/);
  assert.doesNotMatch(workflow, /environment:\s*\n\s*name:\s*production/);
});

test('staging deploy runs only when the repository enables it', async () => {
  const workflow = await readWorkflow('deploy-staging.yml');

  assert.match(
    workflow,
    /if:\s*\$\{\{\s*github\.event\.workflow_run\.conclusion == 'success' && vars\.STAGING_DEPLOY_ENABLED == 'true'\s*\}\}/,
  );
});

test('deployment workflows do not expose secrets to pull request jobs', async () => {
  const publish = await readWorkflow('publish.yml');
  const staging = await readWorkflow('deploy-staging.yml');

  assert.doesNotMatch(publish, /pull_request/);
  assert.doesNotMatch(staging, /pull_request/);
  assert.match(staging, /secrets\./);
});

test('deploy script uses migration before service rollout and never database rollback', async () => {
  const deploy = await readFile(new URL('infra/scripts/deploy.sh', root), 'utf8');

  const executable = deploy
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

  assert.ok(executable.indexOf('run_migration') < executable.indexOf('reconcile_services'));
  assert.doesNotMatch(executable, /migrate\s+(down|reset)|database[_ -]rollback/i);
});

test('smoke script has no mutation commands', async () => {
  const smoke = await readFile(new URL('infra/scripts/smoke.sh', root), 'utf8');

  assert.doesNotMatch(smoke, /docker compose .*\b(up|down|rm|exec)\b/);
  assert.match(smoke, /health\/live/);
  assert.match(smoke, /health\/ready/);
});

test('release workflow runs release-please on main with a GitHub App token', async () => {
  const workflow = await readWorkflow('release.yml');

  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /actions\/create-github-app-token@[0-9a-f]{40}/);
  assert.match(workflow, /googleapis\/release-please-action@[0-9a-f]{40}/);
  assert.match(workflow, /secrets\.RELEASE_APP_ID/);
  assert.match(workflow, /secrets\.RELEASE_APP_PRIVATE_KEY/);
  assert.match(workflow, /token:\s*\$\{\{\s*steps\.app-token\.outputs\.token\s*\}\}/);
  assert.match(workflow, /config-file:\s*release-please-config\.json/);
  assert.match(workflow, /manifest-file:\s*\.release-please-manifest\.json/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.doesNotMatch(workflow, /GITHUB_TOKEN/);
});

test('runtime images bake the application version', async () => {
  const dockerfile = await readFile(new URL('infra/docker/Dockerfile', root), 'utf8');
  const bake = await readFile(new URL('infra/docker/docker-bake.hcl', root), 'utf8');

  assert.match(dockerfile, /ARG APP_VERSION=0\.0\.0-dev/);
  assert.match(dockerfile, /APP_VERSION=\$APP_VERSION/);
  assert.match(dockerfile, /NUXT_PUBLIC_APP_VERSION=\$APP_VERSION/);
  assert.match(bake, /variable "APP_VERSION"/);
  assert.match(bake, /APP_VERSION\s*=\s*APP_VERSION/);
});

test('publish workflow passes the package version into images', async () => {
  const workflow = await readWorkflow('publish.yml');

  assert.match(workflow, /require\('\.\/package\.json'\)\.version/);
  assert.match(workflow, /build-args:\s*\|\s*\n\s*APP_VERSION=\$\{\{ env\.APP_VERSION \}\}/);
  assert.match(workflow, /org\.opencontainers\.image\.version=\$\{\{ env\.APP_VERSION \}\}/);
  assert.match(workflow, /"version=\$\{APP_VERSION\}"/);
});

test('release image tagging reacts to tags and to published images', async () => {
  const workflow = await readWorkflow('tag-release-images.yml');

  assert.match(workflow, /push:\s*\n\s*tags:\s*\['v\*\.\*\.\*'\]/);
  assert.match(workflow, /workflow_run:\s*\n\s*workflows:\s*\[Publish images\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /conclusion == 'success'/);
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /source infra\/scripts\/release\.sh/);
  assert.match(workflow, /resolve_tagged_commit/);
  assert.match(workflow, /--sort=-v:refname/);
  assert.match(workflow, /docker buildx imagetools inspect/);
  assert.match(workflow, /docker buildx imagetools create --tag/);
  assert.match(workflow, /for target in web api worker migrate/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /packages:\s*write/);
  assert.doesNotMatch(workflow, /:latest/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.doesNotMatch(workflow, /workflow_run\.head_sha/);
  for (const block of runBlocks(workflow)) {
    assert.doesNotMatch(block, /\$\{\{\s*github\.event/);
    assert.doesNotMatch(block, /\$\{\{\s*github\.ref_name/);
    assert.doesNotMatch(block, /\$\{\{\s*inputs\./);
  }
});
