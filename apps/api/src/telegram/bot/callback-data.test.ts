import { describe, expect, it } from 'vitest';

import { decodeCallback, encodeCallback } from './callback-data.js';

describe('callback data', () => {
  it('encodes version, action and an optional index', () => {
    expect(encodeCallback(3, 'pick', 12)).toBe('3:pick:12');
    expect(encodeCallback(41, 'save')).toBe('41:save');
  });

  it('decodes what it encodes', () => {
    expect(decodeCallback('3:pick:12')).toEqual({ version: 3, action: 'pick', index: 12 });
    expect(decodeCallback('41:save')).toEqual({ version: 41, action: 'save', index: null });
  });

  it('rejects anything else, including ids and oversized values', () => {
    expect(decodeCallback('')).toBeNull();
    expect(decodeCallback('save')).toBeNull();
    expect(decodeCallback('3:pick:0190f7a2-aaaa')).toBeNull();
    expect(decodeCallback('3:Pick')).toBeNull();
    expect(decodeCallback('1234567:save')).toBeNull();
    expect(decodeCallback('3:pick:1000')).toBeNull();
  });

  it('never produces more than 64 bytes', () => {
    expect(Buffer.byteLength(encodeCallback(999_999, 'abcdefghijkl', 999))).toBeLessThanOrEqual(64);
  });

  it('refuses to encode values the decoder would reject', () => {
    expect(() => encodeCallback(0, 'save')).toThrow();
    expect(() => encodeCallback(1, 'Save')).toThrow();
    expect(() => encodeCallback(1, 'pick', 1000)).toThrow();
  });
});
