import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { ApiConfig } from '../../config/env.js';
import { API_CONFIG, UNSAFE_HTTP_METHODS } from './security.constants.js';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!UNSAFE_HTTP_METHODS.has(request.method)) return true;

    if (request.headers.origin !== this.config.webOrigin) {
      throw new ForbiddenException({
        code: 'ORIGIN_REQUIRED',
        detail: 'Источник запроса не разрешен.',
      });
    }

    return true;
  }
}
