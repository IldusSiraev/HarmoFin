import { describe, expect, it } from 'vitest';

import { demoPeriodDates } from './demo-period-dates.js';
import {
  DEMO_SNAPSHOTS,
  demoSnapshot,
  demoStepText,
  snapshotKey,
  toDashboard,
  toEnvelopeRows,
  toGoalRows,
  type DemoChoices,
  type DemoSnapshot,
} from './demo-scenario.js';

const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), 0n);
const balances = (s: DemoSnapshot) => Object.values(s.envelopes).map((e) => e.balanceMinor);
const PATHS: DemoChoices[] = [
  { split: 'suggested', leftover: 'carry' },
  { split: 'suggested', leftover: 'save' },
  { split: 'vacation', leftover: 'carry' },
  { split: 'vacation', leftover: 'save' },
];

describe('demo scenario snapshots', () => {
  it.each(Object.values(DEMO_SNAPSHOTS))('$key: envelopes + free = cash, total matches', (s) => {
    expect(sum(balances(s)) + BigInt(s.freeToAssignMinor)).toBe(BigInt(s.cashMinor));
    expect(sum(balances(s))).toBe(BigInt(s.envelopesTotalMinor));
    for (const envelope of Object.values(s.envelopes)) {
      expect(BigInt(envelope.balanceMinor)).toBe(
        BigInt(envelope.fundedMinor) - BigInt(envelope.spentMinor),
      );
    }
  });

  it.each(Object.values(DEMO_SNAPSHOTS))('$key: vacation goal progress matches 150 000 ₽', (s) => {
    const current = BigInt(s.envelopes.vacation.balanceMinor);
    expect(BigInt(s.vacationRemainingMinor)).toBe(15_000_000n - current);
    expect(s.vacationProgressPermille).toBe(Number((current * 1000n) / 15_000_000n));
  });

  it.each(PATHS)('path %o changes only the expected envelopes step by step', (choices) => {
    const at = (step: number) => demoSnapshot(step, choices)!;
    const changed = (a: DemoSnapshot, b: DemoSnapshot) =>
      (Object.keys(a.envelopes) as Array<keyof DemoSnapshot['envelopes']>).filter(
        (k) => a.envelopes[k].balanceMinor !== b.envelopes[k].balanceMinor,
      );
    expect(at(1).freeToAssignMinor).toBe('12000000');
    expect(at(2).freeToAssignMinor).toBe('0');
    expect(changed(at(2), at(3))).toEqual(['mandatory']);
    expect(BigInt(at(2).cashMinor) - BigInt(at(3).cashMinor)).toBe(3_600_000n);
    expect(changed(at(3), at(4))).toEqual(['current']);
    expect(BigInt(at(3).cashMinor) - BigInt(at(4).cashMinor)).toBe(1_240_000n);
    expect(at(5)).toEqual(at(4));
    const final = changed(at(5), at(6));
    expect(final).toEqual(choices.leftover === 'save' ? ['current', 'vacation'] : []);
    expect(at(6).cashMinor).toBe(at(5).cashMinor);
  });

  it('requires the choices each step depends on', () => {
    expect(snapshotKey(0, { split: null, leftover: null })).toBe('step0');
    expect(snapshotKey(3, { split: null, leftover: null })).toBeNull();
    expect(snapshotKey(6, { split: 'suggested', leftover: null })).toBeNull();
    expect(snapshotKey(6, { split: 'vacation', leftover: 'save' })).toBe('step6:vacation+save');
  });

  it('maps snapshots into the DTOs the app components read, without changing amounts', () => {
    const dates = demoPeriodDates(10, 15);
    const s = demoSnapshot(4, { split: 'suggested', leftover: null })!;
    const dashboard = toDashboard(s, dates, dates.shoppingTo);
    expect(dashboard.cashMinor).toBe(s.cashMinor);
    expect(dashboard.currentBalanceMinor).toBe(s.envelopes.current.balanceMinor);
    expect(dashboard.spendable).toEqual({
      state: 'READY',
      amountMinor: s.envelopes.current.balanceMinor,
    });
    expect(dashboard.period).toEqual({
      start: '2026-10-10',
      end: '2026-10-24',
      periodId: 'demo-period-salary',
    });
    expect(dashboard.periodStats).toBeNull();
    expect(dashboard.nearestObligations.map((o) => o.name)).toEqual([
      'Детский сад',
      'Коммунальные услуги',
      'Интернет',
    ]);
    expect(toEnvelopeRows(s).map((row) => [row.name, row.balanceMinor])).toEqual([
      ['Обязательные платежи', '1600000'],
      ['Текущие траты', '3260000'],
      ['Отпуск', '1500000'],
      ['Резерв', '800000'],
    ]);
    expect(toGoalRows(s)[0]).toMatchObject({
      name: 'Отпуск',
      currentMinor: '1500000',
      progressPermille: 100,
    });
  });

  it('reports no progress for the period envelope while it has no funding, like the server null', () => {
    const dates = demoPeriodDates(10, 15);
    const s = demoSnapshot(1, { split: null, leftover: null })!;
    const dashboard = toDashboard(s, dates, dates.shoppingTo);
    const current = dashboard.envelopes.find((envelope) => envelope.id === 'demo-env-current');
    expect(current?.progress).toBeNull();
  });

  it('keeps the step 2 caption neutral until a split is chosen', () => {
    const dates = demoPeriodDates(10, 15);
    const before = demoStepText(2, { split: null, leftover: null }, dates);
    expect(before.caption).toBe('Конверты пока пусты — выберите, как распределить зарплату.');
    const after = demoStepText(2, { split: 'suggested', leftover: null }, dates);
    expect(after.caption).toBe('Конверты после распределения зарплаты.');
  });

  it('writes step texts with the visitor cycle dates and glossary terms', () => {
    const dates = demoPeriodDates(5, 10);
    const texts = [0, 1, 2, 3, 4, 5, 6].map((step) =>
      demoStepText(step, { split: 'suggested', leftover: 'save' }, dates),
    );
    expect(texts[1]!.body).toContain('5 октября');
    expect(texts[3]!.body).toContain('9 октября');
    expect(texts.map((t) => `${t.title} ${t.body}`).join(' ')).not.toMatch(/назнач/i);
    expect(texts.every((t) => t.caption.length > 0)).toBe(true);
  });
});
