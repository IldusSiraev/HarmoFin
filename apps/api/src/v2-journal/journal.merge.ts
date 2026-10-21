/** Feed order key shared by transactions and transfers: newest first. */
export type FeedPosition = { occurredOn: string; createdAt: string; id: string };

/** Negative when `a` comes before `b` in the feed (occurredOn, createdAt, id — all desc). */
export function comparePositions(a: FeedPosition, b: FeedPosition): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn > b.occurredOn ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id > b.id ? -1 : 1;
  return 0;
}

export function mergeNewestFirst<T>(
  left: ReadonlyArray<T>,
  right: ReadonlyArray<T>,
  positionOf: (item: T) => FeedPosition,
  limit: number,
): T[] {
  const result: T[] = [];
  let i = 0;
  let j = 0;
  while (result.length < limit && (i < left.length || j < right.length)) {
    const takeLeft =
      j >= right.length ||
      (i < left.length && comparePositions(positionOf(left[i]!), positionOf(right[j]!)) <= 0);
    result.push(takeLeft ? left[i++]! : right[j++]!);
  }
  return result;
}
