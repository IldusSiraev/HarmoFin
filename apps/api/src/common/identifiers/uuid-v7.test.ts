import { describe, expect, it } from 'vitest';

import { createUuidV7 } from './uuid-v7.js';

describe('createUuidV7', () => {
  it('creates a UUIDv7 whose prefix encodes current timestamp', () => {
    const id = createUuidV7(new Date('2026-09-01T00:00:00.000Z'));

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.replaceAll('-', '').slice(0, 12)).toBe('01a05a43fc00');
  });
});
