const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keyset position in `createdAt DESC, id DESC` order. Opaque to the client. */
export interface FeedCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(
    JSON.stringify({ v: 1, createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
  ).toString('base64url');
}

export function decodeCursor(raw: string): FeedCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { v, createdAt, id } = parsed as Record<string, unknown>;
  if (v !== 1 || typeof createdAt !== 'string' || typeof id !== 'string' || !UUID.test(id)) {
    return null;
  }
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? null : { createdAt: date, id };
}
