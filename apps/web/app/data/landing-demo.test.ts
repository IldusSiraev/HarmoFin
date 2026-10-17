import { describe, expect, it } from 'vitest';

import {
  demoCashFlowRows,
  demoDashboard,
  demoEnvelopes,
  demoExpenseByCategoryRows,
  demoLimitRows,
} from './landing-demo.js';

// The landing never computes money; these checks keep the hand-made demo
// rows consistent with each other and with the demo dashboard.
describe('landing demo analytics rows', () => {
  it('расходы по категориям складываются в траты периода, доли — в 10 000', () => {
    const total = demoExpenseByCategoryRows.reduce(
      (sum, row) => sum + BigInt(row.expenseMinor),
      0n,
    );
    expect(total.toString()).toBe(demoDashboard.periodStats?.spentMinor);
    const shares = demoExpenseByCategoryRows.reduce((sum, row) => sum + row.shareBasisPoints, 0);
    expect(shares).toBe(10_000);
  });

  it('лимиты согласованы: лимит = потрачено + осталось − перерасход', () => {
    for (const row of demoLimitRows) {
      const target = BigInt(row.targetMinor ?? '0');
      const balance =
        BigInt(row.spentMinor) + BigInt(row.remainingMinor ?? '0') - BigInt(row.overspentMinor);
      expect(balance).toBe(target);
      expect(row.spentPermille).toBe(Number((BigInt(row.spentMinor) * 1000n) / target));
    }
  });

  it('текущий лимит совпадает с конвертом, прошлый остаток — с дашбордом', () => {
    const current = demoLimitRows.find((row) => row.isCurrent)!;
    const envelope = demoEnvelopes.find((item) => item.id === current.envelopeId)!;
    expect(current.spentMinor).toBe(envelope.spentMinor);
    expect(current.remainingMinor).toBe(envelope.balanceMinor);

    const previous = demoLimitRows.find(
      (row) => row.periodId === demoDashboard.warnings[0]!.periodId,
    )!;
    expect(previous.remainingMinor).toBe(demoDashboard.warnings[0]!.amountMinor);
  });

  it('чистый поток цикла = доходы − расходы', () => {
    for (const row of demoCashFlowRows) {
      expect(BigInt(row.netCashFlowMinor)).toBe(BigInt(row.incomeMinor) - BigInt(row.expenseMinor));
    }
  });
});
