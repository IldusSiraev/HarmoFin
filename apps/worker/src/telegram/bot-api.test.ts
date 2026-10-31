import { describe, expect, it, vi } from 'vitest';

import { TelegramBotApi } from './bot-api.js';

const token = '123456:worker-secret-token';
const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('TelegramBotApi.sendMessage', () => {
  it('posts HTML with url buttons and reports success', async () => {
    const fetchImpl = reply(200, { ok: true, result: {} });
    const api = new TelegramBotApi(token, 'https://api.telegram.org', fetchImpl);
    const result = await api.sendMessage(77n, {
      text: '<b>Тест</b>',
      buttons: [{ text: 'Открыть', url: 'https://x.test/app' }],
    });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: '77',
      text: '<b>Тест</b>',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: 'Открыть', url: 'https://x.test/app' }]] },
    });
  });

  it('returns retry_after on 429', async () => {
    const api = new TelegramBotApi(
      token,
      'https://api.telegram.org',
      reply(429, {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 7',
        parameters: { retry_after: 7 },
      }),
    );
    await expect(api.sendMessage(1n, { text: 'x', buttons: [] })).resolves.toEqual({
      ok: false,
      status: 429,
      description: 'Too Many Requests: retry after 7',
      retryAfter: 7,
    });
  });

  it('reports a non-JSON error body by status only', async () => {
    const fetchImpl = vi.fn(async () => new Response('Bad Gateway', { status: 502 }));
    const api = new TelegramBotApi(token, 'https://api.telegram.org', fetchImpl);
    await expect(api.sendMessage(1n, { text: 'x', buttons: [] })).resolves.toEqual({
      ok: false,
      status: 502,
      description: '',
      retryAfter: null,
    });
  });
});
