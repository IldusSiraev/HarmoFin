import { createHash } from 'node:crypto';

/**
 * The worker mints a random 32-byte token per letter and stores this digest on the delivery row
 * (apps/worker/src/delivery/deliver.handler.ts). Plain SHA-256 is enough for a random token, and
 * the worker has no access to AUTH_TOKEN_HASH_SECRET.
 */
export function hashUnsubscribeToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
