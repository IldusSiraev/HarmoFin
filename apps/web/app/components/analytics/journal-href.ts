/** Journal link for a report row; only string journalFilters become query parameters. */
export function journalHref(row: Record<string, unknown>): string {
  const filters = row.journalFilters;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return '/app/operations';
  const query = new URLSearchParams(
    Object.entries(filters as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string')
      .map(([name, value]) => [name, String(value)]),
  );
  return `/app/operations${query.size > 0 ? `?${query}` : ''}`;
}
