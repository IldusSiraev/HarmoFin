import assert from 'node:assert/strict';
import test from 'node:test';

import { sortKeysDeep } from './sort-keys.mjs';

test('sorts object keys alphabetically at every depth', () => {
  const input = { b: 1, a: { d: 2, c: 3 } };

  assert.deepEqual(Object.keys(sortKeysDeep(input)), ['a', 'b']);
  assert.deepEqual(Object.keys(sortKeysDeep(input).a), ['c', 'd']);
});

test('preserves array order while sorting object keys inside array items', () => {
  const input = [{ b: 1, a: 2 }, { z: 1 }];

  const result = sortKeysDeep(input);

  assert.deepEqual(Object.keys(result[0]), ['a', 'b']);
  assert.deepEqual(Object.keys(result[1]), ['z']);
});

test('returns primitives unchanged', () => {
  assert.equal(sortKeysDeep('value'), 'value');
  assert.equal(sortKeysDeep(42), 42);
  assert.equal(sortKeysDeep(null), null);
});
