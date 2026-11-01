import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import type { ApiConfig } from '../../config/env.js';
import { EXTERNAL_WEBHOOK } from './external-webhook.decorator.js';
import { API_CONFIG, UNSAFE_HTTP_METHODS } from './security.constants.js';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(Reflector) private readonly reflector: Reflector = new Reflector(),
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!UNSAFE_HTTP_METHODS.has(request.method)) return true;
    if (this.isExternalWebhook(context)) return true;

    if (request.headers.origin !== this.config.webOrigin) {
      throw new ForbiddenException({
        code: 'ORIGIN_REQUIRED',
        detail: 'Источник запроса не разрешен.',
      });
    }

    return true;
  }

  private isExternalWebhook(context: ExecutionContext): boolean {
    // Unit tests build a bare context without a handler.
    const handler = typeof context.getHandler === 'function' ? context.getHandler() : undefined;
    return handler !== undefined && this.reflector.get<boolean>(EXTERNAL_WEBHOOK, handler) === true;
  }
}
