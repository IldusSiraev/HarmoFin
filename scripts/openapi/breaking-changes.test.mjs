import assert from 'node:assert/strict';
import test from 'node:test';

import { findBreakingChanges } from './breaking-changes.mjs';

function documentWithPaths(paths) {
  return { openapi: '3.0.0', paths };
}

test('reports no breaking changes for an unmodified contract', () => {
  const document = documentWithPaths({
    '/api/v1/health/live': {
      get: { operationId: 'healthLive', responses: { 200: { description: 'ok' } } },
    },
  });

  assert.deepEqual(findBreakingChanges(document, document), []);
});

test('flags a removed path', () => {
  const base = documentWithPaths({
    '/api/v1/health/live': { get: { responses: { 200: { description: 'ok' } } } },
  });
  const head = documentWithPaths({});

  const changes = findBreakingChanges(base, head);

  assert.ok(changes.some((change) => change.includes('removed path "/api/v1/health/live"')));
});

test('flags a removed operation on an existing path', () => {
  const base = documentWithPaths({
    '/api/v1/health/live': {
      get: { responses: { 200: { description: 'ok' } } },
      post: { responses: { 200: { description: 'ok' } } },
    },
  });
  const head = documentWithPaths({
    '/api/v1/health/live': { get: { responses: { 200: { description: 'ok' } } } },
  });

  const changes = findBreakingChanges(base, head);

  assert.ok(
    changes.some((change) => change.includes('removed operation "post /api/v1/health/live"')),
  );
});

test('flags a new required request body field', () => {
  const requestBody = (properties, required) => ({
    content: {
      'application/json': {
        schema: { type: 'object', properties, required },
      },
    },
  });
  const base = documentWithPaths({
    '/api/v1/auth/login': {
      post: {
        requestBody: requestBody({ email: {}, password: {} }, ['email', 'password']),
        responses: { 200: { description: 'ok' } },
      },
    },
  });
  const head = documentWithPaths({
    '/api/v1/auth/login': {
      post: {
        requestBody: requestBody({ email: {}, password: {}, otp: {} }, [
          'email',
          'password',
          'otp',
        ]),
        responses: { 200: { description: 'ok' } },
      },
    },
  });

  const changes = findBreakingChanges(base, head);

  assert.ok(
    changes.some((change) =>
      change.includes('new required request field "otp" for "post /api/v1/auth/login"'),
    ),
  );
});

test('flags a removed successful response status', () => {
  const base = documentWithPaths({
    '/api/v1/health/ready': {
      get: { responses: { 200: { description: 'ok' }, 503: { description: 'down' } } },
    },
  });
  const head = documentWithPaths({
    '/api/v1/health/ready': {
      get: { responses: { 200: { description: 'ok' } } },
    },
  });

  const changes = findBreakingChanges(base, head);

  assert.ok(
    changes.some((change) =>
      change.includes('removed response status "503" for "get /api/v1/health/ready"'),
    ),
  );
});

test('allows adding a new optional field and a new path', () => {
  const base = documentWithPaths({
    '/api/v1/health/live': { get: { responses: { 200: { description: 'ok' } } } },
  });
  const head = documentWithPaths({
    '/api/v1/health/live': { get: { responses: { 200: { description: 'ok' } } } },
    '/api/v1/health/ready': { get: { responses: { 200: { description: 'ok' } } } },
  });

  assert.deepEqual(findBreakingChanges(base, head), []);
});
