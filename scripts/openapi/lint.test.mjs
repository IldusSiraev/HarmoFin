import assert from 'node:assert/strict';
import test from 'node:test';

import { lintDocument } from './lint.mjs';

function baseDocument(overrides = {}) {
  return {
    openapi: '3.0.0',
    paths: {
      '/api/v1/health/live': {
        get: {
          operationId: 'healthLive',
          responses: { 200: { description: 'ok' } },
        },
      },
    },
    ...overrides,
  };
}

test('accepts a well-formed document', () => {
  assert.deepEqual(lintDocument(baseDocument()), []);
});

test('accepts a /api/v2 path', () => {
  const document = baseDocument({
    paths: {
      '/api/v2/health/live': {
        get: { operationId: 'healthLiveV2', responses: { 200: { description: 'ok' } } },
      },
    },
  });

  assert.deepEqual(lintDocument(document), []);
});

test('flags a path outside the contract prefixes', () => {
  const document = baseDocument({
    paths: {
      '/legacy/health': {
        get: { operationId: 'legacyHealth', responses: { 200: { description: 'ok' } } },
      },
    },
  });

  const issues = lintDocument(document);

  assert.ok(issues.some((issue) => issue.includes('/legacy/health')));
});

test('flags duplicate operationId values across operations', () => {
  const document = baseDocument({
    paths: {
      '/api/v1/health/live': {
        get: { operationId: 'dup', responses: { 200: { description: 'ok' } } },
      },
      '/api/v1/health/ready': {
        get: { operationId: 'dup', responses: { 200: { description: 'ok' } } },
      },
    },
  });

  const issues = lintDocument(document);

  assert.ok(issues.some((issue) => issue.includes('duplicate operationId')));
});

test('flags an operation with no operationId', () => {
  const document = baseDocument({
    paths: {
      '/api/v1/health/live': {
        get: { responses: { 200: { description: 'ok' } } },
      },
    },
  });

  const issues = lintDocument(document);

  assert.ok(issues.some((issue) => issue.includes('operationId')));
});
