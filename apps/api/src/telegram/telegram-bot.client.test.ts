import { describe, expect, it, vi } from 'vitest';

import { HttpTelegramBotClient, TelegramRequestError, webButton } from './telegram-bot.client.js';

const token = '123456:secret-token-value';

function fakeFetch(status: number) {
  return vi.fn(async () => new Response(JSON.stringify({ ok: status === 200 }), { status }));
}

describe('HttpTelegramBotClient', () => {
  it('posts sendMessage as HTML with buttons and no link preview', async () => {
    const fetchImpl = fakeFetch(200);
    const client = new HttpTelegramBotClient(token, 'https://api.telegram.org', fetchImpl);
    await client.sendMessage(4242n, '<b>Привет</b>', [
      { text: 'Открыть', url: 'https://x.test/a' },
    ]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: '4242',
      text: '<b>Привет</b>',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: 'Открыть', url: 'https://x.test/a' }]] },
    });
  });

  it('omits reply_markup without buttons', async () => {
    const fetchImpl = fakeFetch(200);
    const client = new HttpTelegramBotClient(token, 'https://api.telegram.org', fetchImpl);
    await client.sendMessage(1n, 'text');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty('reply_markup');
  });

  it('throws a status-only error that never contains the token', async () => {
    const client = new HttpTelegramBotClient(token, 'https://api.telegram.org', fakeFetch(403));
    const error = await client.sendMessage(1n, 'text').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramRequestError);
    expect((error as TelegramRequestError).status).toBe(403);
    expect(String((error as Error).message)).not.toContain(token);
  });
});

describe('webButton', () => {
  it('builds an absolute https button', () => {
    expect(webButton('https://harmofin.example', 'Настройки', '/app/settings/telegram')).toEqual([
      { text: 'Настройки', url: 'https://harmofin.example/app/settings/telegram' },
    ]);
  });

  it('returns no button for a non-https web address', () => {
    expect(webButton('http://localhost:3000', 'Настройки', '/app/settings/telegram')).toEqual([]);
  });
});
