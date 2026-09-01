import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class TokenService {
  constructor(private readonly tokenHashSecret: string) {}

  createRawToken(): string {
    return randomBytes(32).toString('base64url');
  }

  digest(rawToken: string): string {
    return createHmac('sha256', this.tokenHashSecret).update(rawToken).digest('hex');
  }

  matchesDigest(rawToken: string, storedDigest: string): boolean {
    const actual = Buffer.from(this.digest(rawToken), 'hex');
    const expected = Buffer.from(storedDigest, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
