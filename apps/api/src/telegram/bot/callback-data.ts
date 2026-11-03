/**
 * Inline-button payload "<version>:<action>[:<index>]" (Telegram allows 64 bytes). It never holds
 * ids: the index points into the choice list stored in the dialog state of that version.
 */
export type CallbackAction = { version: number; action: string; index: number | null };

const PATTERN = /^([1-9]\d{0,5}):([a-z]{1,12})(?::(\d{1,3}))?$/;

export function encodeCallback(version: number, action: string, index?: number): string {
  const data = index === undefined ? `${version}:${action}` : `${version}:${action}:${index}`;
  if (!PATTERN.test(data)) throw new Error('Invalid callback data');
  return data;
}

export function decodeCallback(data: string): CallbackAction | null {
  const match = PATTERN.exec(data);
  if (!match) return null;
  return {
    version: Number(match[1]),
    action: match[2]!,
    index: match[3] === undefined ? null : Number(match[3]),
  };
}
