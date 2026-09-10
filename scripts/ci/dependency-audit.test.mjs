import assert from 'node:assert/strict';
import test from 'node:test';

import { filterUnreviewedAdvisories } from './dependency-audit.mjs';

function advisory(overrides = {}) {
  return {
    severity: 'high',
    module_name: 'example-package',
    github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
    title: 'Example vulnerability',
    ...overrides,
  };
}

test('passes through a high-severity advisory with no matching exception', () => {
  const result = filterUnreviewedAdvisories([advisory()], []);

  assert.equal(result.length, 1);
});

test('drops an advisory that matches an exception by GHSA id', () => {
  const advisories = [
    advisory({ module_name: 'nodemailer', github_advisory_id: 'GHSA-rcmh-qjqh-p98v' }),
  ];
  const exceptions = [{ ghsa: 'GHSA-rcmh-qjqh-p98v', module: 'nodemailer', reason: 'reviewed' }];

  assert.deepEqual(filterUnreviewedAdvisories(advisories, exceptions), []);
});

test('keeps a moderate-severity advisory unaffected by high-only filtering upstream', () => {
  const advisories = [advisory({ severity: 'moderate' })];

  const result = filterUnreviewedAdvisories(advisories, []);

  assert.equal(result.length, 1);
});

test('does not drop an advisory when the exception module does not match', () => {
  const advisories = [advisory({ module_name: 'nodemailer', github_advisory_id: 'GHSA-x' })];
  const exceptions = [{ ghsa: 'GHSA-x', module: 'a-different-package', reason: 'reviewed' }];

  assert.equal(filterUnreviewedAdvisories(advisories, exceptions).length, 1);
});
