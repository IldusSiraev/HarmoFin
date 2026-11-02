// The worker posts to the stored endpoint, so only real push services are accepted: an arbitrary
// URL here would let a client make the worker send requests anywhere (SSRF).
const PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
] as const;

export const MAX_ENDPOINT_LENGTH = 2048;

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** The device's ECDH public key: an uncompressed P-256 point (65 bytes, first byte 0x04). */
export function isValidP256dh(value: string): boolean {
  if (!BASE64URL.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 65 && bytes[0] === 4;
}

/** The device's authentication secret: 16 bytes. */
export function isValidAuthSecret(value: string): boolean {
  return BASE64URL.test(value) && Buffer.from(value, 'base64url').length === 16;
}
