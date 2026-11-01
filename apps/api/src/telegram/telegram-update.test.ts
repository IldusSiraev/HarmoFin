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

  it('answers any other private message with help', () => {
    expect(parseTelegramUpdate(message('привет'))).toEqual({ kind: 'help', chatId: 4242n });
    expect(parseTelegramUpdate(message(undefined))).toEqual({ kind: 'help', chatId: 4242n });
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
