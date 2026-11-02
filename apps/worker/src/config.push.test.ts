import { describe, expect, it } from 'vitest';

import { loadWorkerConfig } from './config.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
};
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
const privateKey = Buffer.alloc(32, 9).toString('base64url');
const vapid = {
  VAPID_PUBLIC_KEY: publicKey,
  VAPID_PRIVATE_KEY: privateKey,
  VAPID_SUBJECT: 'mailto:admin@harmofin.example',
};

describe('loadWorkerConfig push', () => {
  it('has no push without VAPID variables', () => {
    expect(loadWorkerConfig(base).push).toBeUndefined();
    expect(
      loadWorkerConfig({ ...base, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' })
        .push,
    ).toBeUndefined();
  });

  it('maps all three variables', () => {
    expect(loadWorkerConfig({ ...base, ...vapid }).push).toEqual({
      publicKey,
      privateKey,
      subject: 'mailto:admin@harmofin.example',
    });
    expect(
      loadWorkerConfig({ ...base, ...vapid, VAPID_SUBJECT: 'https://harmofin.example' }).push
        ?.subject,
    ).toBe('https://harmofin.example');
  });

  it('requires the three variables together', () => {
    expect(() => loadWorkerConfig({ ...base, VAPID_PUBLIC_KEY: publicKey })).toThrow(
      /VAPID_PRIVATE_KEY, VAPID_SUBJECT/,
    );
  });

  it('rejects malformed values without echoing them', () => {
    const bad = { ...base, ...vapid, VAPID_PRIVATE_KEY: 'short-secret', VAPID_SUBJECT: 'admin' };
    expect(() => loadWorkerConfig(bad)).toThrow(/VAPID_PRIVATE_KEY, VAPID_SUBJECT/);
    try {
      loadWorkerConfig(bad);
    } catch (error) {
      expect(String(error)).not.toContain('short-secret');
    }
    expect(() => loadWorkerConfig({ ...base, ...vapid, VAPID_PUBLIC_KEY: 'abc' })).toThrow(
      /VAPID_PUBLIC_KEY/,
    );
  });
});
