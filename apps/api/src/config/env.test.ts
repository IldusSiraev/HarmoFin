import { describe, expect, it } from 'vitest';

import { loadApiConfig } from './env.js';

describe('loadApiConfig', () => {
  it('rejects missing DATABASE_URL', () => {
    expect(() => loadApiConfig({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });

  it('accepts valid local configuration', () => {
    expect(
      loadApiConfig({
        NODE_ENV: 'test',
        API_PORT: '3001',
        DATABASE_URL: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
        WEB_ORIGIN: 'http://localhost:3000',
      }),
    ).toEqual({
      nodeEnv: 'test',
      apiPort: 3001,
      databaseUrl: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
      webOrigin: 'http://localhost:3000',
      logLevel: 'info',
    });
  });

  it('rejects ports outside the TCP range', () => {
    expect(() =>
      loadApiConfig({
        NODE_ENV: 'test',
        API_PORT: '65536',
        DATABASE_URL: 'postgresql://localhost/harmofin',
      }),
    ).toThrow(/API_PORT/);
  });
});
