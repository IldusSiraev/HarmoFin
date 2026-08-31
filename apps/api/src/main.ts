import 'reflect-metadata';

import { createApiApp } from './app.js';
import { createApiLogger } from './common/logging/logger.js';
import { loadApiConfig } from './config/env.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  const app = await createApiApp(config);
  await app.listen(config.apiPort, '0.0.0.0');
  createApiLogger(config).started(config.apiPort);
}

void bootstrap();
