import { describe, expect, it } from 'vitest';

import {
  allocationData,
  analyticsData,
  faqItems,
  goalData,
  heroBudget,
  howItWorksSteps,
  landingNavLinks,
  upcomingPlans,
  variableIncome,
} from './landing.js';

const toNumber = (minorUnits: string): number => Number(BigInt(minorUnits));

describe('landing demo data', () => {
  it('keeps every money value as an integer minor-unit string', () => {
    const values = [
      heroBudget.availableMinor,
      heroBudget.periodLimitMinor,
      heroBudget.spentMinor,
      heroBudget.dailyAverageMinor,
      allocationData.incomeMinor,
      upcomingPlans.reservedMinor,
      variableIncome.plannedMinor,
      ...allocationData.allocations.map((item) => item.amountMinor),
      ...goalData.flatMap((goal) => [goal.savedMinor, goal.targetMinor]),
      ...upcomingPlans.items.map((item) => item.amountMinor),
    ];

    for (const value of values) {
      expect(value).toMatch(/^\d+$/);
    }
  });

  it('never lets allocations exceed the income they belong to', () => {
    const allocated = allocationData.allocations.reduce(
      (sum, item) => sum + toNumber(item.amountMinor),
      0,
    );

    expect(allocated).toBeLessThanOrEqual(toNumber(allocationData.incomeMinor));
  });

  it('keeps spent plus available within the period limit', () => {
    expect(
      toNumber(heroBudget.spentMinor) + toNumber(heroBudget.availableMinor),
    ).toBeLessThanOrEqual(toNumber(heroBudget.periodLimitMinor));
  });

  it('never shows a goal saved above its target', () => {
    for (const goal of goalData) {
      expect(toNumber(goal.savedMinor)).toBeLessThanOrEqual(toNumber(goal.targetMinor));
    }
  });

  it('uses category shares that add up to 100 percent', () => {
    const total = analyticsData.categories.reduce((sum, item) => sum + item.share, 0);

    expect(total).toBe(100);
  });

  it('exposes the sections required by the landing brief', () => {
    expect(landingNavLinks.map((link) => link.href)).toEqual([
      '#features',
      '#how-it-works',
      '#security',
      '#faq',
    ]);
    expect(faqItems).toHaveLength(6);
    expect(howItWorksSteps).toHaveLength(5);
    expect(variableIncome.cases).toHaveLength(2);
  });
});
