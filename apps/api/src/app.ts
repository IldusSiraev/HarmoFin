import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Http2ServerRequest } from 'node:http2';

import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter.js';
import { createApiLogger, type ApiEventLogger } from './common/logging/logger.js';
import { OriginGuard } from './common/security/origin.guard.js';
import type { ApiConfig } from './config/env.js';
import { createErrorReporter, MetricsRegistry } from './observability/observability.js';

export async function createApiApp(config: ApiConfig): Promise<NestFastifyApplication> {
  const logger = createApiLogger(config);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    new FastifyAdapter({
      bodyLimit: 1_048_576,
      trustProxy: config.trustProxy,
      genReqId: (request: IncomingMessage | Http2ServerRequest) => {
        const header = request.headers['x-request-id'];
        return (
          (typeof header === 'string' && header.length > 0 ? header : undefined) ?? randomUUID()
        );
      },
    }),
    { logger: config.logLevel === 'silent' ? false : logger },
  );

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet);
  await app.register(fastifyRateLimit, { global: false });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin: config.webOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  app.useGlobalFilters(
    new ProblemDetailsFilter(
      createErrorReporter(config.errorReportingEndpoint),
      (fields) => logger.unhandledError(fields),
      config.nodeEnv !== 'production',
    ),
  );
  app.useGlobalGuards(new OriginGuard(config));
  registerObservabilityHooks(app.getHttpAdapter().getInstance(), app.get(MetricsRegistry), logger);
  registerMetricsRoute(app.getHttpAdapter().getInstance(), app.get(MetricsRegistry));
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('HarmoFin API')
      .setDescription('Контракт API HarmoFin')
      .setVersion('1.0')
      .addCookieAuth(config.auth.cookieName, { type: 'apiKey', in: 'cookie' }, 'session')
      .build(),
  );
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: '/openapi.json' });

  return app;
}

function registerObservabilityHooks(
  server: FastifyInstance,
  metrics: MetricsRegistry,
  logger: ApiEventLogger,
): void {
  const startedAt = new WeakMap<FastifyRequest, number>();

  server.addHook('onRequest', (request, reply, done) => {
    startedAt.set(request, Date.now());
    reply.header('x-request-id', request.id);
    done();
  });

  server.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url ?? 'unknown';
    const durationMs = Date.now() - (startedAt.get(request) ?? Date.now());
    metrics.recordHttpRequest(request.method, route, reply.statusCode, durationMs);
    logger.requestOutcome({
      requestId: String(request.id),
      method: request.method,
      route,
      status: reply.statusCode,
      durationMs,
      ...(reply.statusCode >= 500 ? { errorCode: 'INTERNAL_ERROR' } : {}),
    });
    done();
  });
}

function registerMetricsRoute(server: FastifyInstance, metrics: MetricsRegistry): void {
  server.get('/internal/metrics', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.type('text/plain; version=0.0.4; charset=utf-8');
    return metrics.render();
  });
}
