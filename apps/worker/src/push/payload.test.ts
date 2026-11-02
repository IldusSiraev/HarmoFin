import { describe, expect, it } from 'vitest';

import { pushTopic, renderPushPayload } from './payload.js';

const id = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';

describe('renderPushPayload', () => {
  it('builds title, body, path and a tag from the urgent content', () => {
    expect(
      renderPushPayload(
        {
          subject: 'Просрочен платёж «Ипотека»',
          lines: ['План «Ипотека» просрочен с 2026-10-25.'],
          actionPath: '/app/plans?occurrence=1',
        },
        id,
      ),
    ).toEqual({
      title: 'Просрочен платёж «Ипотека»',
      body: 'План «Ипотека» просрочен с 2026-10-25.',
      path: '/app/plans?occurrence=1',
      tag: `notification:${id}`,
    });
  });

  it('cuts a long body to 200 characters', () => {
    const payload = renderPushPayload(
      { subject: 'Напоминание: «Собрание»', lines: ['а'.repeat(500)], actionPath: '/app' },
      id,
    );
    expect(payload.body).toHaveLength(200);
    expect(payload.body.endsWith('…')).toBe(true);
  });

  it('stays well under the 4 KB push limit', () => {
    const payload = renderPushPayload(
      { subject: 'я'.repeat(300), lines: ['я'.repeat(500)], actionPath: '/app/notifications' },
      id,
    );
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(3_000);
  });
});

describe('pushTopic', () => {
  it('is the id without dashes, 32 URL-safe characters', () => {
    expect(pushTopic(id)).toBe('0192f3a45b6c7d8e9f0123456789abcd');
    expect(pushTopic(id)).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });
});
