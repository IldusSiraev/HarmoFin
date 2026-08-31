import { describe, expect, it } from 'vitest';

import { loadWorkerConfig } from './config.js';

describe('loadWorkerConfig', () => {
  it('uses safe defaults for local execution', () => {
    expect(loadWorkerConfig({ NODE_ENV: 'test' })).toEqual({
      nodeEnv: 'test',
      logLevel: 'info',
    });
  });

  it('rejects unsupported log levels', () => {
    expect(() => loadWorkerConfig({ NODE_ENV: 'test', LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
