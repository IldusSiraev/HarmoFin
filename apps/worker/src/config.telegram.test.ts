import { describe, expect, it } from 'vitest';

import { loadWorkerConfig } from './config.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://worker:worker@localhost:5432/harmofin',
};

describe('loadWorkerConfig telegram', () => {
  it('has no telegram without a bot token', () => {
    expect(loadWorkerConfig(base).telegram).toBeUndefined();
    expect(loadWorkerConfig({ ...base, TELEGRAM_BOT_TOKEN: '' }).telegram).toBeUndefined();
  });

  it('maps the token with the default API base URL and the web address', () => {
    expect(
      loadWorkerConfig({
        ...base,
        TELEGRAM_BOT_TOKEN: '123456:worker-token',
        WEB_BASE_URL: 'https://harmofin.example',
      }).telegram,
    ).toEqual({
      botToken: '123456:worker-token',
      apiBaseUrl: 'https://api.telegram.org',
      webBaseUrl: 'https://harmofin.example',
    });
  });

  it('strips a trailing slash from a custom API base URL', () => {
    const config = loadWorkerConfig({
      ...base,
      TELEGRAM_BOT_TOKEN: '123456:worker-token',
      TELEGRAM_API_BASE_URL: 'http://127.0.0.1:9/',
      WEB_BASE_URL: 'http://localhost:3000',
    });
    expect(config.telegram?.apiBaseUrl).toBe('http://127.0.0.1:9');
  });

  it('requires WEB_BASE_URL with a bot token', () => {
    expect(() => loadWorkerConfig({ ...base, TELEGRAM_BOT_TOKEN: '123456:worker-token' })).toThrow(
      /WEB_BASE_URL/,
    );
  });
});
