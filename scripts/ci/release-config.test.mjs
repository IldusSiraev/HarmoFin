import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../..', import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

async function appPackagePaths() {
  const entries = await readdir(new URL('apps/', root), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `apps/${entry.name}/package.json`)
    .sort();
}

test('release-please releases the whole product as one node package', async () => {
  const config = await readJson('release-please-config.json');

  assert.equal(config['release-type'], 'node');
  assert.equal(config['include-component-in-tag'], false);
  assert.deepEqual(Object.keys(config.packages), ['.']);
});

test('release-please syncs the version into every app package', async () => {
  const config = await readJson('release-please-config.json');
  const synced = config.packages['.']['extra-files']
    .filter((file) => file.type === 'json' && file.jsonpath === '$.version')
    .map((file) => file.path)
    .sort();

  assert.deepEqual(synced, await appPackagePaths());
});

test('root, manifest and app packages carry the same version', async () => {
  const rootPackage = await readJson('package.json');
  const manifest = await readJson('.release-please-manifest.json');

  assert.match(rootPackage.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest['.'], rootPackage.version);
  for (const path of await appPackagePaths()) {
    const appPackage = await readJson(path);
    assert.equal(appPackage.version, rootPackage.version, path);
  }
});

test('changelog sections are Russian and hide technical commit types', async () => {
  const config = await readJson('release-please-config.json');
  const sections = Object.fromEntries(
    config['changelog-sections'].map((section) => [section.type, section]),
  );

  assert.equal(sections.feat.section, 'Новое');
  assert.equal(sections.fix.section, 'Исправления');
  assert.equal(sections.perf.section, 'Производительность');
  assert.equal(sections.revert.section, 'Откаты');
  for (const type of ['docs', 'chore', 'test', 'style', 'refactor', 'ci', 'build']) {
    assert.equal(sections[type]?.hidden, true, type);
  }
});
