import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { API_CONFIG } from '../common/security/security.constants.js';
import type { ApiConfig } from '../config/env.js';

interface Counter {
  count: number;
  expiresAt: number;
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly counters = new Map<string, Counter>();

  constructor(@Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'rateLimit'>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const path = new URL(request.url, 'http://localhost').pathname;
    const maximum = this.maximumFor(path, request.method);
    if (!maximum) return true;

    const now = Date.now();
    const key = `${path}:${request.ip}`;
    const existing = this.counters.get(key);
    const counter =
      existing && existing.expiresAt > now
        ? existing
        : { count: 0, expiresAt: now + this.config.rateLimit.windowSeconds * 1_000 };
    counter.count += 1;
    this.counters.set(key, counter);
    if (counter.count > maximum) {
      throw new HttpException(
        { code: 'AUTH_RATE_LIMITED', detail: 'Слишком много попыток. Повторите позже.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private maximumFor(url: string, method: string): number | null {
    if (url.startsWith('/api/v1/auth/login')) return this.config.rateLimit.loginMax;
    if (url.startsWith('/api/v1/auth/recovery/request')) return this.config.rateLimit.recoveryMax;
    if (url.startsWith('/api/v1/auth/deletion/cancel')) return this.config.rateLimit.recoveryMax;
    if (url.startsWith('/api/v1/invitations/preview')) return this.config.rateLimit.recoveryMax;
    if (url.startsWith('/api/v1/invitations/accept')) return this.config.rateLimit.recoveryMax;
    if (/^\/api\/v1\/workspaces\/[^/]+\/invitations(\/[^/]+\/resend)?$/.test(url) && method === 'POST')
      return this.config.rateLimit.loginMax;
    return null;
  }
}
