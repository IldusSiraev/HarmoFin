import { describe, expect, it } from 'vitest';

import { loadApiConfig } from './env.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
  AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  MAIL_FROM: 'no-reply@harmofin.test',
  WEB_BASE_URL: 'http://localhost:3000',
};

// 65 bytes: 0x04 followed by 64 bytes, base64url without padding (87 characters).
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');

describe('loadApiConfig push', () => {
  it('leaves push out without a key or with an empty key', () => {
    expect(loadApiConfig(base).push).toBeUndefined();
    expect(loadApiConfig({ ...base, VAPID_PUBLIC_KEY: '' }).push).toBeUndefined();
  });

  it('maps a valid public key', () => {
    expect(loadApiConfig({ ...base, VAPID_PUBLIC_KEY: publicKey }).push).toEqual({
      vapidPublicKey: publicKey,
    });
  });

  it('rejects a key of the wrong length or point format', () => {
    expect(() => loadApiConfig({ ...base, VAPID_PUBLIC_KEY: publicKey.slice(1) })).toThrow(
      /VAPID_PUBLIC_KEY/,
    );
    const compressed = Buffer.concat([Buffer.from([3]), Buffer.alloc(64, 7)]).toString('base64url');
    expect(() => loadApiConfig({ ...base, VAPID_PUBLIC_KEY: compressed })).toThrow(
      /VAPID_PUBLIC_KEY/,
    );
  });

  it('never accepts the private key variable name as a config field', () => {
    const config = loadApiConfig({ ...base, VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: 'x' });
    expect(JSON.stringify(config)).not.toContain('"x"');
  });
});
