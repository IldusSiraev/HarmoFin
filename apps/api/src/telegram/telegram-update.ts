import { createHash, timingSafeEqual } from 'node:crypto';

export type TelegramUpdateAction =
  | { kind: 'start'; chatId: bigint; code: string | null }
  | { kind: 'stop'; chatId: bigint }
  | { kind: 'help'; chatId: bigint }
  | { kind: 'blocked'; chatId: bigint }
  | { kind: 'ignore' };

const START = /^\/start(?:\s+(\S+))?$/;
const STOP = /^\/stop$/;
// Telegram deep-link payload: up to 64 characters of A-Z, a-z, 0-9, _ and -.
const CODE = /^[A-Za-z0-9_-]{1,64}$/;

function privateChatId(chat: unknown): bigint | null {
  if (!chat || typeof chat !== 'object') return null;
  const { id, type } = chat as { id?: unknown; type?: unknown };
  if (type !== 'private') return null;
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return null;
  return BigInt(id);
}

/**
 * Turns a raw Telegram Update into the one action the bot supports. Only private chats count;
 * groups, channels and every other update type are ignored without a reply.
 */
export function parseTelegramUpdate(update: unknown): TelegramUpdateAction {
  if (!update || typeof update !== 'object') return { kind: 'ignore' };
  const { message, my_chat_member: member } = update as {
    message?: unknown;
    my_chat_member?: unknown;
  };

  if (member && typeof member === 'object') {
    const { chat, new_chat_member: next } = member as {
      chat?: unknown;
      new_chat_member?: { status?: unknown };
    };
    const chatId = privateChatId(chat);
    if (chatId !== null && next?.status === 'kicked') return { kind: 'blocked', chatId };
    return { kind: 'ignore' };
  }

  if (message && typeof message === 'object') {
    const { chat, text } = message as { chat?: unknown; text?: unknown };
    const chatId = privateChatId(chat);
    if (chatId === null) return { kind: 'ignore' };
    if (typeof text !== 'string') return { kind: 'help', chatId };
    const trimmed = text.trim();
    const start = START.exec(trimmed);
    if (start) {
      const raw = start[1];
      return { kind: 'start', chatId, code: raw && CODE.test(raw) ? raw : null };
    }
    if (STOP.test(trimmed)) return { kind: 'stop', chatId };
    return { kind: 'help', chatId };
  }

  return { kind: 'ignore' };
}

/** Constant-time comparison of the X-Telegram-Bot-Api-Secret-Token header. */
export function webhookSecretMatches(received: string | undefined, expected: string): boolean {
  if (typeof received !== 'string' || received.length === 0) return false;
  const actual = createHash('sha256').update(received).digest();
  const wanted = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actual, wanted);
}
