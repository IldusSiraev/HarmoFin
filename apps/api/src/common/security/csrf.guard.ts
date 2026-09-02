import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { RequestContext } from '../request-context/request-context.js';
import type { ApiConfig } from '../../config/env.js';
import { API_CONFIG, UNSAFE_HTTP_METHODS } from './security.constants.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!UNSAFE_HTTP_METHODS.has(request.method)) return true;

    const rawToken = request.headers['x-csrf-token'];
    const token = typeof rawToken === 'string' ? rawToken : undefined;
    const storedHash = request.authContext?.csrfTokenHash;
    if (
      !token ||
      !storedHash ||
      !matchesDigest(token, storedHash, this.config.auth.tokenHashSecret)
    ) {
      throw new ForbiddenException({
        code: 'CSRF_INVALID',
        detail: 'Защита запроса не пройдена.',
      });
    }

    return true;
  }
}

function matchesDigest(rawToken: string, expectedDigest: string, secret: string): boolean {
  const actualDigest = createHmac('sha256', secret).update(rawToken).digest('hex');
  const expected = Buffer.from(expectedDigest, 'hex');
  const actual = Buffer.from(actualDigest, 'hex');

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
