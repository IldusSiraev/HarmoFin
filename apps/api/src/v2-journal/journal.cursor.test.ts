import { describe, expect, it } from 'vitest';

import { decodeFeedCursor, encodeFeedCursor } from './journal.cursor.js';

const position = {
  occurredOn: '2026-10-20',
  createdAt: '2026-10-20T10:00:00.000Z',
  id: '0195f3c3-aaaa-7bbb-8ccc-000000000001',
};

describe('journal cursor', () => {
  it('кодирует и декодирует позицию', () => {
    expect(decodeFeedCursor(encodeFeedCursor(position))).toEqual(position);
  });

  it.each([
    'garbage',
    Buffer.from('{"v":2}').toString('base64url'),
    encodeFeedCursor({ ...position, id: 'not-uuid' }),
    encodeFeedCursor({ ...position, occurredOn: '20-10-2026' }),
    encodeFeedCursor({ ...position, createdAt: '2026' }),
  ])('некорректный курсор %s — 400 VALIDATION_FAILED', (value) => {
    expect(() => decodeFeedCursor(value)).toThrowError(
      expect.objectContaining({ response: expect.objectContaining({ code: 'VALIDATION_FAILED' }) }),
    );
  });
});
