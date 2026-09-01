import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter.js';
import { createApiLogger } from './common/logging/logger.js';
import { OriginGuard } from './common/security/origin.guard.js';
import type { ApiConfig } from './config/env.js';

export async function createApiApp(config: ApiConfig): Promise<NestFastifyApplication> {
  const logger = createApiLogger(config);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    new FastifyAdapter({ bodyLimit: 1_048_576 }),
    { logger: config.logLevel === 'silent' ? false : logger },
  );

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet);
  await app.register(fastifyRateLimit, { global: false });

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.webOrigin, credentials: true });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalGuards(new OriginGuard(config));
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('HarmoFin API')
      .setDescription('Контракт API HarmoFin')
      .setVersion('1.0')
      .build(),
  );
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: '/openapi.json' });

  return app;
}
