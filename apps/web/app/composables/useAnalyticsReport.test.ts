import { beforeEach, describe, expect, it, vi } from 'vitest';

const v2 = { getReport: vi.fn() };
vi.mock('./useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => v2,
}));

import { useAnalyticsReport } from './useAnalyticsReport.js';

describe('useAnalyticsReport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('до первой загрузки loading=true (скелетон, не пустое состояние)', () => {
    const report = useAnalyticsReport('net-cash-flow');
    expect(report.loading.value).toBe(true);
    expect(report.rows.value).toEqual([]);
    expect(report.error.value).toBe('');
  });

  it('загружает строки ключа с фильтрами', async () => {
    v2.getReport.mockResolvedValue({ key: 'expenses-by-category', rows: [{ categoryId: 'c' }] });
    const report = useAnalyticsReport('expenses-by-category');
    await report.load('budget-id', { from: '2026-03-01' });
    expect(v2.getReport).toHaveBeenCalledWith('budget-id', 'expenses-by-category', {
      from: '2026-03-01',
    });
    expect(report.rows.value).toEqual([{ categoryId: 'c' }]);
    expect(report.loading.value).toBe(false);
    expect(report.error.value).toBe('');
  });

  it('ошибка даёт текст и пустые строки', async () => {
    v2.getReport.mockRejectedValue(new Error('boom'));
    const report = useAnalyticsReport('net-cash-flow');
    await report.load('budget-id');
    expect(report.error.value).toBe('Не удалось загрузить отчёт.');
    expect(report.rows.value).toEqual([]);
  });

  it('устаревший ответ не перетирает новый', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    v2.getReport
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ key: 'net-cash-flow', rows: [{ cycleStart: 'new' }] });
    const report = useAnalyticsReport('net-cash-flow');
    const first = report.load('budget-id', { from: '2026-01-01' });
    await report.load('budget-id', { from: '2026-02-01' });
    resolveFirst({ key: 'net-cash-flow', rows: [{ cycleStart: 'old' }] });
    await first;
    expect(report.rows.value).toEqual([{ cycleStart: 'new' }]);
  });
});
