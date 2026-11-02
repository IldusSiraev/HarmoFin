import { describe, expect, it } from 'vitest';

import { summarizePush } from './summary.js';

const now = new Date('2026-11-02T09:00:00.000Z');
const ok = { status: 201, retryAfterSeconds: null };

describe('summarizePush', () => {
  it('counts delivered devices', () => {
    expect(
      summarizePush(
        [
          { id: 'a', result: ok },
          { id: 'b', result: { status: 200, retryAfterSeconds: null } },
        ],
        now,
      ),
    ).toEqual({ delivered: ['a', 'b'], gone: [], transient: null, permanent: null, retryAt: null });
  });

  it('marks 404, 410 and 403 as gone', () => {
    const summary = summarizePush(
      [404, 410, 403].map((status, index) => ({
        id: String(index),
        result: { status, retryAfterSeconds: null },
      })),
      now,
    );
    expect(summary.gone).toEqual(['0', '1', '2']);
    expect(summary.delivered).toEqual([]);
  });

  it('waits for the latest Retry-After of 429 answers, 60 seconds by default', () => {
    const summary = summarizePush(
      [
        { id: 'a', result: { status: 429, retryAfterSeconds: 120 } },
        { id: 'b', result: { status: 429, retryAfterSeconds: null } },
      ],
      now,
    );
    expect(summary.retryAt).toEqual(new Date(now.getTime() + 120_000));
  });

  it('treats 5xx and network errors as transient and other 4xx as permanent', () => {
    expect(
      summarizePush([{ id: 'a', result: { status: 503, retryAfterSeconds: null } }], now).transient,
    ).toBe('PUSH_503');
    expect(summarizePush([{ id: 'a', result: 'network' }], now).transient).toBe('PUSH_NETWORK');
    expect(
      summarizePush([{ id: 'a', result: { status: 413, retryAfterSeconds: null } }], now).permanent,
    ).toBe('PUSH_413');
  });
});
