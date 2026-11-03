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

describe('HttpTelegramBotClient keyboards', () => {
  function respond(status: number, body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status }));
  }
  const keyboard = [
    [{ text: 'Да', callback_data: '1:ok' }],
    [{ text: 'Сайт', url: 'https://x.test' }],
  ];

  it('sends rows of callback and url buttons and returns the message id', async () => {
    const fetchImpl = respond(200, { ok: true, result: { message_id: 77 } });
    const client = new HttpTelegramBotClient(token, 'https://api.telegram.org', fetchImpl);
    expect(await client.sendKeyboard(5n, 'Текст', keyboard)).toBe(77);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(JSON.parse(init.body as string)).toMatchObject({
      chat_id: '5',
      text: 'Текст',
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  it('returns null when Telegram reports no message id', async () => {
    const client = new HttpTelegramBotClient(
      token,
      'https://api.telegram.org',
      respond(200, { ok: true, result: {} }),
    );
    expect(await client.sendKeyboard(5n, 'Текст', [])).toBeNull();
  });

  it('edits a message and tolerates "message is not modified"', async () => {
    const fetchImpl = respond(400, {
      ok: false,
      description: 'Bad Request: message is not modified: specified new message content',
    });
    const client = new HttpTelegramBotClient(token, 'https://api.telegram.org', fetchImpl);
    await expect(client.editKeyboard(5n, 9, 'Текст', keyboard)).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${token}/editMessageText`);
    expect(JSON.parse(init.body as string)).toMatchObject({ chat_id: '5', message_id: 9 });
  });

  it('throws on any other edit error without the token', async () => {
    const client = new HttpTelegramBotClient(
      token,
      'https://api.telegram.org',
      respond(400, { ok: false, description: 'Bad Request: message to edit not found' }),
    );
    const error = await client.editKeyboard(5n, 9, 'Т', []).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramRequestError);
    expect(String((error as Error).message)).not.toContain(token);
  });

  it('answers a callback query with an optional notice', async () => {
    const fetchImpl = respond(200, { ok: true, result: true });
    const client = new HttpTelegramBotClient(token, 'https://api.telegram.org', fetchImpl);
    await client.answerCallback('cb-1', 'Устарело');
    await client.answerCallback('cb-2');
    const bodies = fetchImpl.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string) as unknown,
    );
    expect(bodies).toEqual([
      { callback_query_id: 'cb-1', text: 'Устарело' },
      { callback_query_id: 'cb-2' },
    ]);
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
