import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { RequestContext } from '../common/request-context/request-context.js';
import { API_CONFIG } from '../common/security/security.constants.js';
import type { ApiConfig } from '../config/env.js';
import { SessionService } from './session.service.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(SessionService) private readonly sessionService: Pick<SessionService, 'authenticate'>,
    @Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'auth'>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawToken = request.cookies[this.config.auth.cookieName];
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw new UnauthorizedException({
        code: 'SESSION_REQUIRED',
        detail: 'Требуется вход в систему.',
      });
    }

    const session = await this.sessionService.authenticate(rawToken);
    if (!session) {
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        detail: 'Сессия недействительна или истекла.',
      });
    }

    request.authContext = session;
    return true;
  }
}
