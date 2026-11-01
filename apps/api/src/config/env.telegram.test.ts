import { describe, expect, it } from 'vitest';

import { loadApiConfig } from './env.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin',
  AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  MAIL_FROM: 'no-reply@harmofin.test',
  WEB_BASE_URL: 'http://localhost:3000',
};

const telegram = {
  TELEGRAM_BOT_TOKEN: '123456:test-token-value-abcdef',
  TELEGRAM_BOT_USERNAME: 'harmofin_test_bot',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-with-at-least-32-chars_',
};

describe('loadApiConfig telegram', () => {
  it('leaves telegram out when no variable is set', () => {
    expect(loadApiConfig(base).telegram).toBeUndefined();
  });

  it('treats empty strings as not set', () => {
    const config = loadApiConfig({
      ...base,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_BOT_USERNAME: '',
      TELEGRAM_WEBHOOK_SECRET: '',
    });
    expect(config.telegram).toBeUndefined();
  });

  it('maps a complete telegram configuration with the default API base URL', () => {
    expect(loadApiConfig({ ...base, ...telegram }).telegram).toEqual({
      botToken: '123456:test-token-value-abcdef',
      botUsername: 'harmofin_test_bot',
      webhookSecret: 'webhook-secret-with-at-least-32-chars_',
      apiBaseUrl: 'https://api.telegram.org',
    });
  });

  it('accepts a custom API base URL without a trailing slash', () => {
    const config = loadApiConfig({
      ...base,
      ...telegram,
      TELEGRAM_API_BASE_URL: 'http://127.0.0.1:9/',
    });
    expect(config.telegram?.apiBaseUrl).toBe('http://127.0.0.1:9');
  });

  it('rejects a partial telegram configuration', () => {
    expect(() =>
      loadApiConfig({ ...base, TELEGRAM_BOT_TOKEN: telegram.TELEGRAM_BOT_TOKEN }),
    ).toThrow(/TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET/);
  });

  it('rejects a short or unsafe webhook secret', () => {
    expect(() => loadApiConfig({ ...base, ...telegram, TELEGRAM_WEBHOOK_SECRET: 'short' })).toThrow(
      /TELEGRAM_WEBHOOK_SECRET/,
    );
    expect(() =>
      loadApiConfig({ ...base, ...telegram, TELEGRAM_WEBHOOK_SECRET: `${'a'.repeat(32)}!` }),
    ).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });

  it('rejects an invalid bot username', () => {
    expect(() =>
      loadApiConfig({ ...base, ...telegram, TELEGRAM_BOT_USERNAME: '@bad name' }),
    ).toThrow(/TELEGRAM_BOT_USERNAME/);
  });
});
