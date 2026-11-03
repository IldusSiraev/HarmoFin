import { describe, expect, it } from 'vitest';

import { parseTelegramUpdate, webhookSecretMatches } from './telegram-update.js';

const privateChat = { id: 4242, type: 'private' };
const message = (text: unknown, chat: object = privateChat) => ({
  update_id: 1,
  message: { message_id: 1, chat, text },
});

describe('parseTelegramUpdate', () => {
  it('reads /start with a code', () => {
    expect(parseTelegramUpdate(message('/start abc_DEF-123'))).toEqual({
      kind: 'start',
      chatId: 4242n,
      code: 'abc_DEF-123',
    });
  });

  it('reads /start without a code or with an invalid code as code null', () => {
    expect(parseTelegramUpdate(message('/start'))).toEqual({
      kind: 'start',
      chatId: 4242n,
      code: null,
    });
    expect(parseTelegramUpdate(message('/start bad!code'))).toEqual({
      kind: 'start',
      chatId: 4242n,
      code: null,
    });
    expect(parseTelegramUpdate(message(`/start ${'a'.repeat(65)}`))).toEqual({
      kind: 'start',
      chatId: 4242n,
      code: null,
    });
  });

  it('reads /stop', () => {
    expect(parseTelegramUpdate(message('/stop'))).toEqual({ kind: 'stop', chatId: 4242n });
  });

  it('reads other commands by name, lowercased, without the bot suffix or arguments', () => {
    expect(parseTelegramUpdate(message('/expense'))).toEqual({
      kind: 'command',
      chatId: 4242n,
      command: 'expense',
    });
    expect(parseTelegramUpdate(message('/Last@harmofin_bot 5'))).toEqual({
      kind: 'command',
      chatId: 4242n,
      command: 'last',
    });
  });

  it('passes plain text through, trimmed and capped at 1000 characters', () => {
    expect(parseTelegramUpdate(message('  1 250,50 '))).toEqual({
      kind: 'text',
      chatId: 4242n,
      text: '1 250,50',
    });
    const long = parseTelegramUpdate(message('я'.repeat(1_500)));
    expect(long).toMatchObject({ kind: 'text' });
    expect((long as { text: string }).text).toHaveLength(1_000);
  });

  it('answers a message without text or with blank text with help', () => {
    expect(parseTelegramUpdate(message(undefined))).toEqual({ kind: 'help', chatId: 4242n });
    expect(parseTelegramUpdate(message('   '))).toEqual({ kind: 'help', chatId: 4242n });
  });

  it('reads a pressed button of a private chat', () => {
    const update = {
      update_id: 5,
      callback_query: {
        id: 'cb-1',
        data: '3:acc:1',
        message: { message_id: 17, chat: privateChat },
      },
    };
    expect(parseTelegramUpdate(update)).toEqual({
      kind: 'callback',
      chatId: 4242n,
      callbackId: 'cb-1',
      messageId: 17,
      data: '3:acc:1',
    });
  });

  it('ignores buttons of groups and malformed callback queries', () => {
    const group = {
      update_id: 6,
      callback_query: {
        id: 'cb',
        data: 'x',
        message: { message_id: 1, chat: { id: -1, type: 'group' } },
      },
    };
    expect(parseTelegramUpdate(group)).toEqual({ kind: 'ignore' });
    expect(
      parseTelegramUpdate({
        update_id: 7,
        callback_query: { id: 'cb', message: { chat: privateChat } },
      }),
    ).toEqual({ kind: 'ignore' });
    expect(parseTelegramUpdate({ update_id: 8, callback_query: { id: 'cb', data: 'x' } })).toEqual({
      kind: 'ignore',
    });
  });

  it('ignores groups, channels and malformed chats', () => {
    expect(parseTelegramUpdate(message('/start abc', { id: -100, type: 'group' }))).toEqual({
      kind: 'ignore',
    });
    expect(parseTelegramUpdate(message('/start abc', { id: 'x', type: 'private' }))).toEqual({
      kind: 'ignore',
    });
    expect(parseTelegramUpdate({ update_id: 2 })).toEqual({ kind: 'ignore' });
    expect(parseTelegramUpdate(null)).toEqual({ kind: 'ignore' });
  });

  it('reads a blocked bot from my_chat_member', () => {
    const update = {
      update_id: 3,
      my_chat_member: { chat: privateChat, new_chat_member: { status: 'kicked' } },
    };
    expect(parseTelegramUpdate(update)).toEqual({ kind: 'blocked', chatId: 4242n });
  });

  it('ignores other membership changes', () => {
    const update = {
      update_id: 4,
      my_chat_member: { chat: privateChat, new_chat_member: { status: 'member' } },
    };
    expect(parseTelegramUpdate(update)).toEqual({ kind: 'ignore' });
  });
});

describe('webhookSecretMatches', () => {
  const secret = 'webhook-secret-with-at-least-32-chars_';

  it('accepts the exact secret only', () => {
    expect(webhookSecretMatches(secret, secret)).toBe(true);
    expect(webhookSecretMatches(`${secret}x`, secret)).toBe(false);
    expect(webhookSecretMatches('', secret)).toBe(false);
    expect(webhookSecretMatches(undefined, secret)).toBe(false);
  });
});
