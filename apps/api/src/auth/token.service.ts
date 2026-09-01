import { createHmac, randomBytes } from 'node:crypto';

export class TokenService {
  constructor(private readonly tokenHashSecret: string) {}

  createRawToken(): string {
    return randomBytes(32).toString('base64url');
  }

  digest(rawToken: string): string {
    return createHmac('sha256', this.tokenHashSecret).update(rawToken).digest('hex');
  }
}
