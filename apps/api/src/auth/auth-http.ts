import type { FastifyRequest } from 'fastify';

import type { RequestContext } from '../common/request-context/request-context.js';
import type { ApiConfig } from '../config/env.js';
import type { RequestMeta } from './auth.application.service.js';

export type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

export function requestMeta(request: FastifyRequest): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
    ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
  };
}

export function requiredContext(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}

export function cookieOptions(config: ApiConfig) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.nodeEnv === 'production',
    path: '/',
  };
}
