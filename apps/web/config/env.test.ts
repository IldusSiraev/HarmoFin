import { describe, expect, it } from 'vitest';

import { loadWebConfig } from './env.js';

describe('loadWebConfig', () => {
  it('accepts a configured web port and API URL', () => {
    expect(
      loadWebConfig({
        WEB_PORT: '3100',
        API_URL: 'http://localhost:3101',
      }),
    ).toEqual({
      webPort: 3100,
      apiUrl: 'http://localhost:3101',
    });
  });

  it('uses safe local defaults', () => {
    expect(loadWebConfig({})).toEqual({
      webPort: 3000,
      apiUrl: 'http://localhost:3001',
    });
  });

  it('rejects ports outside the TCP range', () => {
    expect(() => loadWebConfig({ WEB_PORT: '0' })).toThrow(/WEB_PORT/);
  });
});
