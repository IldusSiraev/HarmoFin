import { describe, expect, it } from 'vitest';

import { isAllowedPushEndpoint, isValidAuthSecret, isValidP256dh } from './push-endpoint.js';

const p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
const auth = Buffer.alloc(16, 2).toString('base64url');

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accepts %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pass@fcm.googleapis.com/fcm/send/abc',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/send',
    'https://notfcm.googleapis.com/send',
    'https://127.0.0.1/push',
    'not a url',
    `https://fcm.googleapis.com/${'a'.repeat(2048)}`,
  ])('rejects %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe('device keys', () => {
  it('accepts browser keys with and without padding', () => {
    expect(isValidP256dh(p256dh)).toBe(true);
    expect(isValidAuthSecret(auth)).toBe(true);
    expect(isValidAuthSecret(`${auth}==`)).toBe(true);
  });

  it('rejects keys of the wrong size, format or alphabet', () => {
    expect(isValidP256dh(p256dh.slice(4))).toBe(false);
    expect(
      isValidP256dh(Buffer.concat([Buffer.from([3]), Buffer.alloc(64, 1)]).toString('base64url')),
    ).toBe(false);
    expect(isValidP256dh(`${p256dh.slice(1)}+`)).toBe(false);
    expect(isValidAuthSecret(Buffer.alloc(15, 2).toString('base64url'))).toBe(false);
    expect(isValidAuthSecret('')).toBe(false);
  });
});
