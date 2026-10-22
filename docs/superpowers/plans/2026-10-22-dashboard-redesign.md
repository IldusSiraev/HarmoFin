# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the app dashboard to the owner's Figma Make prototype and add three additive server fields (`protectedMinor`, obligation coverage, envelope progress) so the web never computes money.

**Architecture:** Server: pure domain functions (`dashboard-v2-progress.domain.ts`) compute coverage and progress from rows the dashboard read already loads inside its RepeatableRead read-only transaction; DTO/OpenAPI gain optional-free additive fields. Web: existing dashboard components are reshaped (hero with two panels, attention grid, full-width obligations, envelope progress via existing `UiProgress`, operations grouped by day) and the page reassembles them.

**Tech Stack:** NestJS 11 + Fastify, Prisma, PostgreSQL 18, Vitest; Nuxt 4 / Vue 3.5, `@vue/test-utils`, `@lucide/vue`.

**Spec:** `docs/superpowers/specs/2026-10-22-dashboard-redesign-design.md`

## Global Constraints

- Money is `bigint` on the server and minor-unit strings over the wire; the web never adds or subtracts money (only sign/zero string checks, formatting, and `progressPercent` for bar width).
- Every query keeps its `budget_id` filter; no new queries, only extra selected columns.
- `/api/v2/budgets/{budgetId}/dashboard` changes are additive only; existing fields keep their meaning.
- UI text in Russian; code identifiers in English.
- Visual rules: `docs/superpowers/specs/2026-09-17-calm-fintech-visual-guidelines.md` (card treatment, envelope type colours only on icon tile and progress fill, `UiMoreLink` for "all" links, status = icon + text).
- Do not run local Playwright. Do not create worktrees. Do not modify `identity/logo_description.png`.
- Commits only after owner approval; subagents stage only, the main session commits each reviewed task.
- Integration tests need local infra: `pnpm infra:up` must already be running (never run `infra:down`).

---

### Task 1: API domain — obligation coverage and envelope progress

**Files:**
- Create: `apps/api/src/v2-dashboard/dashboard-v2-progress.domain.ts`
- Test: `apps/api/src/v2-dashboard/dashboard-v2-progress.domain.test.ts`

**Interfaces:**
- Produces:
  - `type ObligationCoverage = 'COVERED' | 'PARTIAL' | 'UNCOVERED'`
  - `obligationCoverage(items: ReadonlyArray<{ envelopeId: string; unpaidMinor: bigint }>, balanceByEnvelope: ReadonlyMap<string, bigint>): Array<{ coverage: ObligationCoverage; shortfallMinor: bigint }>` — same order and length as `items`.
  - `type EnvelopeProgress = { kind: 'SPENT' | 'COVERED' | 'GOAL'; valueMinor: bigint; maxMinor: bigint; shortfallMinor: bigint | null }`
  - `envelopeProgress(input: { envelopeType: EnvelopeType; balance: bigint; targetAmountMinor: bigint | null; isMainPeriodEnvelope: boolean; mainPeriod: { spent: bigint; available: bigint } | null; mandatoryDue: bigint }): EnvelopeProgress | null`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';

import { envelopeProgress, obligationCoverage } from './dashboard-v2-progress.domain.js';

describe('obligationCoverage', () => {
  it('покрывает платежи одного конверта по порядку из его остатка', () => {
    const balances = new Map([['m', 3_500_000n]]);
    expect(
      obligationCoverage(
        [
          { envelopeId: 'm', unpaidMinor: 100_000n },
          { envelopeId: 'm', unpaidMinor: 4_500_000n },
          { envelopeId: 'm', unpaidMinor: 200_000n },
        ],
        balances,
      ),
    ).toEqual([
      { coverage: 'COVERED', shortfallMinor: 0n },
      { coverage: 'PARTIAL', shortfallMinor: 1_100_000n },
      { coverage: 'UNCOVERED', shortfallMinor: 200_000n },
    ]);
  });

  it('остаток одного обязательного конверта не покрывает платежи другого', () => {
    const balances = new Map([
      ['a', 500_000n],
      ['b', 0n],
    ]);
    expect(
      obligationCoverage(
        [
          { envelopeId: 'b', unpaidMinor: 300_000n },
          { envelopeId: 'a', unpaidMinor: 300_000n },
        ],
        balances,
      ),
    ).toEqual([
      { coverage: 'UNCOVERED', shortfallMinor: 300_000n },
      { coverage: 'COVERED', shortfallMinor: 0n },
    ]);
  });

  it('отрицательный или неизвестный остаток ничего не покрывает', () => {
    const balances = new Map([['m', -50_000n]]);
    expect(
      obligationCoverage(
        [
          { envelopeId: 'm', unpaidMinor: 10_000n },
          { envelopeId: 'x', unpaidMinor: 10_000n },
        ],
        balances,
      ),
    ).toEqual([
      { coverage: 'UNCOVERED', shortfallMinor: 10_000n },
      { coverage: 'UNCOVERED', shortfallMinor: 10_000n },
    ]);
  });
});

describe('envelopeProgress', () => {
  const base = {
    balance: 0n,
    targetAmountMinor: null,
    isMainPeriodEnvelope: false,
    mainPeriod: null,
    mandatoryDue: 0n,
  };

  it('SPENT: главный конверт периода — потрачено из было доступно', () => {
    expect(
      envelopeProgress({
        ...base,
        envelopeType: 'CURRENT_EXPENSES',
        isMainPeriodEnvelope: true,
        mainPeriod: { spent: 5_317_483n, available: 6_101_249n },
      }),
    ).toEqual({ kind: 'SPENT', valueMinor: 5_317_483n, maxMinor: 6_101_249n, shortfallMinor: null });
  });

  it('SPENT нет без настроенного периода, при нулевом доступном и у второй половины', () => {
    expect(
      envelopeProgress({ ...base, envelopeType: 'CURRENT_EXPENSES', isMainPeriodEnvelope: true }),
    ).toBeNull();
    expect(
      envelopeProgress({
        ...base,
        envelopeType: 'CURRENT_EXPENSES',
        isMainPeriodEnvelope: true,
        mainPeriod: { spent: 0n, available: 0n },
      }),
    ).toBeNull();
    expect(
      envelopeProgress({
        ...base,
        envelopeType: 'CURRENT_EXPENSES',
        mainPeriod: { spent: 1n, available: 10n },
      }),
    ).toBeNull();
  });

  it('COVERED: обязательный конверт — отложено из к оплате и недостача', () => {
    expect(
      envelopeProgress({
        ...base,
        envelopeType: 'MANDATORY_EXPENSES',
        balance: 2_608_957n,
        mandatoryDue: 7_984_300n,
      }),
    ).toEqual({
      kind: 'COVERED',
      valueMinor: 2_608_957n,
      maxMinor: 7_984_300n,
      shortfallMinor: 5_375_343n,
    });
    expect(
      envelopeProgress({
        ...base,
        envelopeType: 'MANDATORY_EXPENSES',
        balance: 9_000_000n,
        mandatoryDue: 7_984_300n,
      }),
    ).toEqual({
      kind: 'COVERED',
      valueMinor: 9_000_000n,
      maxMinor: 7_984_300n,
      shortfallMinor: 0n,
    });
  });

  it('COVERED: отрицательный остаток считается нулём; без платежей полосы нет', () => {
    expect(
      envelopeProgress({
        ...base,
        envelopeType: 'MANDATORY_EXPENSES',
        balance: -100n,
        mandatoryDue: 1_000n,
      }),
    ).toEqual({ kind: 'COVERED', valueMinor: 0n, maxMinor: 1_000n, shortfallMinor: 1_000n });
    expect(envelopeProgress({ ...base, envelopeType: 'MANDATORY_EXPENSES', balance: 5n })).toBeNull();
  });

  it('GOAL: накопления, резерв и свой конверт с целью', () => {
    for (const envelopeType of ['SAVINGS_GOAL', 'RESERVE', 'CUSTOM'] as const) {
      expect(
        envelopeProgress({ ...base, envelopeType, balance: 300_000n, targetAmountMinor: 2_000_000n }),
      ).toEqual({ kind: 'GOAL', valueMinor: 300_000n, maxMinor: 2_000_000n, shortfallMinor: null });
    }
  });

  it('нет полосы без цели, с нулевой целью и у FREE_MONEY', () => {
    expect(envelopeProgress({ ...base, envelopeType: 'SAVINGS_GOAL', balance: 1n })).toBeNull();
    expect(
      envelopeProgress({ ...base, envelopeType: 'SAVINGS_GOAL', targetAmountMinor: 0n }),
    ).toBeNull();
    expect(
      envelopeProgress({ ...base, envelopeType: 'FREE_MONEY', targetAmountMinor: 100n }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/v2-dashboard/dashboard-v2-progress.domain.test.ts`
(If the filter name differs, run from `apps/api`: `npx vitest run --config vitest.config.ts src/v2-dashboard/dashboard-v2-progress.domain.test.ts`.)
Expected: FAIL — cannot resolve `./dashboard-v2-progress.domain.js`.

- [ ] **Step 3: Implement**

```ts
import type { EnvelopeType } from '@prisma/client';

export type ObligationCoverage = 'COVERED' | 'PARTIAL' | 'UNCOVERED';

export type EnvelopeProgress = {
  kind: 'SPENT' | 'COVERED' | 'GOAL';
  valueMinor: bigint;
  maxMinor: bigint;
  shortfallMinor: bigint | null;
};

const positive = (value: bigint) => (value > 0n ? value : 0n);
const GOAL_TYPES = new Set<EnvelopeType>(['SAVINGS_GOAL', 'RESERVE', 'CUSTOM']);

/**
 * Greedy coverage of open mandatory payments, in the given (due date, id) order, from the positive
 * balance of each payment's own envelope. Exact for a date-ordered prefix of the open list.
 */
export function obligationCoverage(
  items: ReadonlyArray<{ envelopeId: string; unpaidMinor: bigint }>,
  balanceByEnvelope: ReadonlyMap<string, bigint>,
): Array<{ coverage: ObligationCoverage; shortfallMinor: bigint }> {
  const remaining = new Map<string, bigint>();
  return items.map((item) => {
    const left =
      remaining.get(item.envelopeId) ?? positive(balanceByEnvelope.get(item.envelopeId) ?? 0n);
    const covered = left < item.unpaidMinor ? left : item.unpaidMinor;
    remaining.set(item.envelopeId, left - covered);
    const shortfall = item.unpaidMinor - covered;
    const coverage: ObligationCoverage =
      shortfall === 0n ? 'COVERED' : covered === 0n ? 'UNCOVERED' : 'PARTIAL';
    return { coverage, shortfallMinor: shortfall };
  });
}

/** Display progress of one dashboard envelope; both ends are server sums, never a client total. */
export function envelopeProgress(input: {
  envelopeType: EnvelopeType;
  balance: bigint;
  targetAmountMinor: bigint | null;
  isMainPeriodEnvelope: boolean;
  mainPeriod: { spent: bigint; available: bigint } | null;
  mandatoryDue: bigint;
}): EnvelopeProgress | null {
  if (input.envelopeType === 'CURRENT_EXPENSES') {
    if (!input.isMainPeriodEnvelope || !input.mainPeriod || input.mainPeriod.available <= 0n) {
      return null;
    }
    return {
      kind: 'SPENT',
      valueMinor: input.mainPeriod.spent,
      maxMinor: input.mainPeriod.available,
      shortfallMinor: null,
    };
  }
  if (input.envelopeType === 'MANDATORY_EXPENSES') {
    if (input.mandatoryDue <= 0n) return null;
    const held = positive(input.balance);
    return {
      kind: 'COVERED',
      valueMinor: held,
      maxMinor: input.mandatoryDue,
      shortfallMinor: positive(input.mandatoryDue - held),
    };
  }
  if (!GOAL_TYPES.has(input.envelopeType)) return null;
  if (input.targetAmountMinor === null || input.targetAmountMinor <= 0n) return null;
  return {
    kind: 'GOAL',
    valueMinor: positive(input.balance),
    maxMinor: input.targetAmountMinor,
    shortfallMinor: null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: same command as Step 2. Expected: PASS, 9 tests.

- [ ] **Step 5: Stage**

```bash
git add apps/api/src/v2-dashboard/dashboard-v2-progress.domain.ts apps/api/src/v2-dashboard/dashboard-v2-progress.domain.test.ts
```

Main session commits after review: `feat(api): покрытие платежей и прогресс конвертов для дашборда`.

---

### Task 2: API — wire new fields into the dashboard read, DTO and OpenAPI

**Files:**
- Modify: `apps/api/src/v2-dashboard/dashboard-v2.repository.ts` (types `NearestObligation`, `UpcomingOccurrence`, `DashboardEnvelope`; `listEnvelopes`, `upcoming`, `nearestObligations`)
- Modify: `apps/api/src/v2-dashboard/dashboard-v2.application.service.ts` (`DashboardV2Summary`, `compute`)
- Modify: `apps/api/src/v2-dashboard/dashboard-v2.dto.ts`
- Modify: `openapi.json` (regenerated)
- Test: `apps/api/test/v2-dashboard.integration.test.ts`

**Interfaces:**
- Consumes: `obligationCoverage`, `envelopeProgress` from Task 1.
- Produces (response JSON, consumed by Task 3):
  - `protectedMinor: string`
  - `nearestObligations[].coverage: 'COVERED' | 'PARTIAL' | 'UNCOVERED'`, `nearestObligations[].shortfallMinor: string`
  - `envelopes[].progress: { kind: 'SPENT' | 'COVERED' | 'GOAL'; valueMinor: string; maxMinor: string; shortfallMinor: string | null } | null`

- [ ] **Step 1: Write the failing integration tests**

In `apps/api/test/v2-dashboard.integration.test.ts`:

1. Extend helpers (bottom of file):

```ts
async function envelope(
  w: World,
  envelopeType: 'CURRENT_EXPENSES' | 'MANDATORY_EXPENSES' | 'SAVINGS_GOAL',
  name: string,
  periodSlot?: 'FIRST' | 'SECOND',
  targetAmountMinor?: bigint,
): Promise<string> {
  const created = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      name,
      envelopeType,
      startingBalanceMinor: 0n,
      displayOrder: 950,
      ...(periodSlot ? { periodSlot } : {}),
      ...(targetAmountMinor !== undefined ? { targetAmountMinor } : {}),
    },
  });
  return created.id;
}
```

and in `occurrence` add `envelopeId?: string` to `options`, using `const envelopeId = planType === 'EXPENSE' ? (options.envelopeId ?? w.mandatoryEnvelopeId) : null;`.

2. In the test `'UX-22: статистика периода, ближайшие обязательства и конверты считает сервер'` replace the `nearestObligations` expectation and add progress expectations:

```ts
    expect(summary.nearestObligations).toEqual([
      {
        occurrenceId: expect.any(String),
        name: 'План',
        scheduledOn: '2026-03-11',
        unpaidMinor: '100000',
        coverage: 'COVERED',
        shortfallMinor: '0',
      },
      {
        occurrenceId: expect.any(String),
        name: 'План',
        scheduledOn: '2026-03-12',
        unpaidMinor: '4500000',
        coverage: 'PARTIAL',
        shortfallMinor: '1100000',
      },
      {
        occurrenceId: expect.any(String),
        name: 'План',
        scheduledOn: '2026-03-13',
        unpaidMinor: '200000',
        coverage: 'UNCOVERED',
        shortfallMinor: '200000',
      },
    ]);
    const byId = new Map(summary.envelopes.map((row) => [row.id, row]));
    expect(byId.get(w.mainEnvelopeId)?.progress).toEqual({
      kind: 'SPENT',
      valueMinor: '0',
      maxMinor: '6500000',
      shortfallMinor: null,
    });
    // Horizon ends 2026-03-31: 100k + 4.5M + 200k + 300k + 1M = 6.1M due, 3.5M held.
    expect(byId.get(w.mandatoryEnvelopeId)?.progress).toEqual({
      kind: 'COVERED',
      valueMinor: '3500000',
      maxMinor: '6100000',
      shortfallMinor: '2600000',
    });
    // The internal envelope column of upcoming rows never leaks into the response.
    expect(Object.keys(summary.upcoming[0]!).sort()).toEqual([
      'occurrenceId',
      'scheduledOn',
      'unpaidMinor',
    ]);
```

3. Add new tests inside `describe('v2 dashboard summary (P01)')`:

```ts
  it('protectedMinor, прогресс цели накоплений и конверт без цели', async () => {
    const w = await world(10_000_000n);
    const period = await addPeriod(w, w.mainEnvelopeId, PERIOD.start, PERIOD.end, 'CONFIRMED', 1_000_000n);
    await assign(w, w.mainEnvelopeId, period, 1_000_000n);
    await assign(w, w.mandatoryEnvelopeId, null, 3_500_000n);
    const goal = await envelope(w, 'SAVINGS_GOAL', 'Автомобиль', undefined, 2_000_000n);
    const plain = await envelope(w, 'SAVINGS_GOAL', 'Подушка');
    await assign(w, goal, null, 300_000n);
    await assign(w, plain, null, 200_000n);

    const summary = await service.summary(w.userId, w.budgetId, ASOF);
    expect(summary.protectedMinor).toBe('4000000');
    const byId = new Map(summary.envelopes.map((row) => [row.id, row]));
    expect(byId.get(goal)?.progress).toEqual({
      kind: 'GOAL',
      valueMinor: '300000',
      maxMinor: '2000000',
      shortfallMinor: null,
    });
    expect(byId.get(plain)?.progress).toBeNull();
    // No mandatory payments in the horizon: no coverage bar.
    expect(byId.get(w.mandatoryEnvelopeId)?.progress).toBeNull();
  });

  it('покрытие платежа считается из остатка его конверта, чужой бюджет не влияет', async () => {
    const w = await world(10_000_000n);
    const second = await envelope(w, 'MANDATORY_EXPENSES', 'Ипотека');
    await assign(w, w.mandatoryEnvelopeId, null, 600_000n);
    await occurrence(w, 300_000n, '2026-03-11', { envelopeId: second });
    await occurrence(w, 300_000n, '2026-03-12');
    const other = await world(10_000_000n);
    await occurrence(other, 900_000n, '2026-03-11');

    const summary = await service.summary(w.userId, w.budgetId, ASOF);
    expect(summary.nearestObligations.map((item) => [item.coverage, item.shortfallMinor])).toEqual([
      ['UNCOVERED', '300000'],
      ['COVERED', '0'],
    ]);
  });
```

4. In the OpenAPI test add `'protectedMinor'` to the expected `DashboardV2Response` property list and after it:

```ts
    expect(Object.keys(document.components.schemas.DashboardV2NearestObligationResponse!.properties ?? {})).toEqual(
      expect.arrayContaining(['coverage', 'shortfallMinor']),
    );
    expect(Object.keys(document.components.schemas.DashboardV2EnvelopeResponse!.properties ?? {})).toContain(
      'progress',
    );
    expect(document.components.schemas.DashboardV2EnvelopeProgressResponse).toBeDefined();
```

- [ ] **Step 2: Run to verify failure**

Run (infra already up): `pnpm --filter @harmofin/api test:integration -- v2-dashboard` (or from `apps/api`: `pnpm test:integration -- test/v2-dashboard.integration.test.ts`).
Expected: FAIL — missing `coverage`, `progress`, `protectedMinor`; `envelope`/`occurrence` helper typecheck is fine.

- [ ] **Step 3: Repository**

In `dashboard-v2.repository.ts`:
- `NearestObligation` and `UpcomingOccurrence` get `envelopeId: string`.
- `DashboardEnvelope` gets `targetAmountMinor: bigint | null`; `listEnvelopes` select adds `targetAmountMinor: true` (filter `where: { budgetId }` unchanged).
- In both `upcoming` and `nearestObligations` SQL add `o."envelope_id" AS "envelopeId",` to the SELECT list, add `envelopeId: string` to the `$queryRaw` row type, and map `envelopeId: row.envelopeId`. WHERE, JOIN and ORDER BY stay unchanged.

- [ ] **Step 4: Service**

In `dashboard-v2.application.service.ts`:
- Import `envelopeProgress, obligationCoverage` from `./dashboard-v2-progress.domain.js`.
- `DashboardV2Summary`: add `protectedMinor: string`; extend `nearestObligations` items with `coverage: 'COVERED' | 'PARTIAL' | 'UNCOVERED'; shortfallMinor: string`; extend `envelopes` items with `progress: { kind: 'SPENT' | 'COVERED' | 'GOAL'; valueMinor: string; maxMinor: string; shortfallMinor: string | null } | null`.
- In `compute`, after `balanceByEnvelope` is built:

```ts
    const dueByEnvelope = new Map<string, bigint>();
    for (const item of upcoming) {
      dueByEnvelope.set(item.envelopeId, (dueByEnvelope.get(item.envelopeId) ?? 0n) + item.unpaidMinor);
    }
    const coverage = obligationCoverage(nearest, balanceByEnvelope);
    const mainPeriod = needsSetup ? null : { spent: mainSpent, available: mainBalance + mainSpent };
```

- Return additions:

```ts
      protectedMinor: formatMinorUnits(positive(mandatoryBalance) + otherProtected),
```

```ts
      nearestObligations: nearest.map((item, index) => ({
        occurrenceId: item.occurrenceId,
        name: item.name,
        scheduledOn: item.scheduledOn,
        unpaidMinor: formatMinorUnits(item.unpaidMinor),
        coverage: coverage[index]!.coverage,
        shortfallMinor: formatMinorUnits(coverage[index]!.shortfallMinor),
      })),
```

```ts
      envelopes: envelopeList.map(({ envelope, balance }) => {
        const progress = envelopeProgress({
          envelopeType: envelope.envelopeType,
          balance,
          targetAmountMinor: envelope.targetAmountMinor,
          isMainPeriodEnvelope: periodRow !== null && envelope.id === periodRow.envelopeId,
          mainPeriod,
          mandatoryDue: dueByEnvelope.get(envelope.id) ?? 0n,
        });
        return {
          id: envelope.id,
          name: envelope.name,
          envelopeType: envelope.envelopeType,
          periodSlot: envelope.periodSlot,
          balanceMinor: formatMinorUnits(balance),
          progress: progress && {
            kind: progress.kind,
            valueMinor: formatMinorUnits(progress.valueMinor),
            maxMinor: formatMinorUnits(progress.maxMinor),
            shortfallMinor:
              progress.shortfallMinor === null ? null : formatMinorUnits(progress.shortfallMinor),
          },
        };
      }),
```

- `upcoming` mapping in the return stays exactly `{ occurrenceId, scheduledOn, unpaidMinor }` (do not spread the row).

Note: `SPENT` uses the main envelope's summed balance row list only through `mainPeriod`; `available` equals `periodStats.availableMinor` by construction.

- [ ] **Step 5: DTO**

In `dashboard-v2.dto.ts` add before `DashboardV2EnvelopeResponse`:

```ts
export class DashboardV2EnvelopeProgressResponse {
  @ApiProperty({
    type: String,
    enum: ['SPENT', 'COVERED', 'GOAL'],
    description:
      'SPENT — потрачено из было доступно в текущем периоде; COVERED — отложено из к оплате до конца горизонта; GOAL — накоплено из цели.',
  })
  kind!: 'SPENT' | 'COVERED' | 'GOAL';

  @ApiProperty({ type: String, pattern: '^\\d+$', description: 'Текущее значение в minor units.' })
  valueMinor!: string;

  @ApiProperty({ type: String, pattern: '^\\d+$', description: 'Полное значение шкалы в minor units (> 0).' })
  maxMinor!: string;

  @ApiProperty({
    type: String,
    pattern: '^\\d+$',
    nullable: true,
    description: 'Только для COVERED: сколько не хватает до суммы к оплате; иначе null.',
  })
  shortfallMinor!: string | null;
}
```

In `DashboardV2EnvelopeResponse` add:

```ts
  @ApiProperty({
    type: DashboardV2EnvelopeProgressResponse,
    nullable: true,
    description: 'Шкала конверта для дашборда; null, если шкалы нет (нет цели, платежей или периода).',
  })
  progress!: DashboardV2EnvelopeProgressResponse | null;
```

In `DashboardV2NearestObligationResponse` add:

```ts
  @ApiProperty({
    type: String,
    enum: ['COVERED', 'PARTIAL', 'UNCOVERED'],
    description:
      'Покрытие платежа остатком его обязательного конверта: платежи распределяются по сроку, просроченные первыми.',
  })
  coverage!: 'COVERED' | 'PARTIAL' | 'UNCOVERED';

  @ApiProperty({ type: String, pattern: '^\\d+$', description: 'Непокрытая часть платежа в minor units.' })
  shortfallMinor!: string;
```

In `DashboardV2Response` after `otherProtectedMinor` add:

```ts
  @ApiProperty({
    type: String,
    pattern: MONEY,
    description:
      'Отложено на обязательные платежи (не меньше нуля) и накопления/прочие конверты вне текущего периода.',
  })
  protectedMinor!: string;
```

- [ ] **Step 6: Run tests**

Run: integration command from Step 2 and `pnpm --filter @harmofin/api test`. Expected: PASS.

- [ ] **Step 7: Regenerate and check OpenAPI**

```bash
node scripts/openapi/generate.mjs
git show HEAD:openapi.json > openapi.base.json
node scripts/openapi/check.mjs openapi.json openapi.base.json
rm openapi.base.json
```

Expected: check passes (additive change); `openapi.json` diff shows only the new schema and properties.

- [ ] **Step 8: Typecheck and stage**

Run: `pnpm --filter @harmofin/api typecheck` (or `pnpm typecheck`; web errors about missing fields are expected until Task 3 and are fixed there).

```bash
git add apps/api/src/v2-dashboard apps/api/test/v2-dashboard.integration.test.ts openapi.json
```

Commit after Financial, Security, API and QA review: `feat(api): поля покрытия, прогресса и отложенного в дашборде`.

---

### Task 3: Web — contract types and fixtures

**Files:**
- Modify: `apps/web/app/composables/useEnvelopePlanV2.ts:189-259`
- Modify: every fixture `typecheck` reports (expected: `apps/web/app/data/demo-scenario.ts`, `apps/web/app/data/landing-demo.ts`, `apps/web/app/pages/app/index.test.ts`, `apps/web/app/components/dashboard/AvailableBudgetCard.test.ts`, `apps/web/app/components/dashboard/PeriodDecisionCard.test.ts`, envelope page tests that build `DashboardV2Response`)

**Interfaces:**
- Produces:

```ts
export type DashboardObligationCoverage = 'COVERED' | 'PARTIAL' | 'UNCOVERED';
export interface DashboardEnvelopeProgress {
  kind: 'SPENT' | 'COVERED' | 'GOAL';
  valueMinor: string;
  maxMinor: string;
  shortfallMinor: string | null;
}
```

and in `DashboardV2Response`: `nearestObligations[]` + `coverage: DashboardObligationCoverage; shortfallMinor: string`, `envelopes[]` + `progress: DashboardEnvelopeProgress | null`, top-level `protectedMinor: string`.

- [ ] **Step 1: Edit the type** as above (exported next to `DashboardV2Response`).

- [ ] **Step 2: Run typecheck to list broken fixtures**

Run: `pnpm --filter @harmofin/web typecheck` (or `pnpm typecheck`). Expected: errors in fixtures missing the new fields.

- [ ] **Step 3: Fix fixtures**

For each reported literal: add `protectedMinor` (= the fixture's `mandatoryBalanceMinor` when `otherProtectedMinor` is `'0'`, otherwise a value the fixture's story supports; tests that do not assert it may use `'0'`), `coverage: 'COVERED', shortfallMinor: '0'` on obligations, `progress: null` on envelopes. In `demo-scenario.ts`/`landing-demo.ts` use plausible demo values: current envelope `progress: { kind: 'SPENT', valueMinor: <periodStats.spentMinor>, maxMinor: <periodStats.availableMinor>, shortfallMinor: null }`, mandatory `kind: 'COVERED'` with the demo's mandatory balance/due and gap, obligations covered in date order. Keep `demo-scenario.test.ts` green.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web test`. Expected: PASS (no behaviour change yet).

- [ ] **Step 5: Stage** changed files. Commit: `feat(web): типы новых полей дашборда`.

---

### Task 4: Web — hero: embedded timeline, spendable panel, overview panel

**Files:**
- Modify: `apps/web/app/components/dashboard/FinancialMonthTimeline.vue`
- Modify: `apps/web/app/components/dashboard/FinancialMonthTimeline.test.ts`
- Modify: `apps/web/app/components/dashboard/AvailableBudgetCard.vue`
- Modify: `apps/web/app/components/dashboard/AvailableBudgetCard.test.ts`
- Create: `apps/web/app/components/dashboard/DashboardOverviewPanel.vue`
- Create: `apps/web/app/components/dashboard/DashboardOverviewPanel.test.ts`

**Interfaces:**
- Consumes: `DashboardV2Response` (Task 3).
- Produces:
  - `FinancialMonthTimeline` prop `embedded?: boolean` (default `false`).
  - `AvailableBudgetCard` props `{ dashboard: DashboardV2Response }`, **no emits** (the `assign` emit is removed; Task 5 owns the free-money action). Root has no card chrome; the page wraps it.
  - `DashboardOverviewPanel` props `{ dashboard: DashboardV2Response }`, no emits; root `<section aria-labelledby="dashboard-overview-title">`.

- [ ] **Step 1: Failing tests**

`FinancialMonthTimeline.test.ts` — add:

```ts
  it('drops its own card surface when embedded, keeping the same summary', () => {
    const props = { cycle: { start: '2026-10-10', end: '2026-11-09' }, period: { start: '2026-10-10', end: '2026-10-24' }, asOf: '2026-10-22' };
    const standalone = mount(FinancialMonthTimeline, { props });
    const embedded = mount(FinancialMonthTimeline, { props: { ...props, embedded: true } });
    expect(embedded.classes()).toContain('fm-timeline--embedded');
    expect(standalone.classes()).not.toContain('fm-timeline--embedded');
    expect(embedded.get('[role="img"]').attributes('aria-label')).toBe(
      standalone.get('[role="img"]').attributes('aria-label'),
    );
    expect(embedded.text()).not.toContain('%');
  });
```

(Import `mount` and `FinancialMonthTimeline` the same way the file already does.)

`AvailableBudgetCard.test.ts`:
- Delete tests: `'shows the server spendable amount with period balance and mandatory gap'`, `'offers to assign free money as an action and shows the server amount'`, `'hides the free money action when nothing is free to assign'`, `'marks due obligations as possibly incomplete and reveals breakdown on request'`, and the whole `describe('AvailableBudgetCard breakdown markup')` except its last two tests (`'shows the period figures…'`, `'hides the period figures…'`), which move into the main `describe`.
- Add `protectedMinor: '0'` to `v2Base` if Task 3 did not.
- Add:

```ts
  it('shows the server amount, its deadline and the embedded month timeline', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { dashboard: v2Base }, global: { stubs } });
    const text = normalize(wrapper.text());

    expect(text).toContain('Можно потратить');
    expect(text).toContain('55 000,00 ₽');
    expect(text).toContain('До 9 октября · доступно в текущем конверте');
    expect(wrapper.findComponent({ name: 'FinancialMonthTimeline' }).props('embedded')).toBe(true);
    // The gap and free money now live in the attention block, the breakdown in the overview.
    expect(text).not.toContain('Не хватает на обязательные');
    expect(wrapper.find('[data-action="toggle-breakdown"]').exists()).toBe(false);
  });

  it('keeps the incomplete-due note', () => {
    const wrapper = mount(AvailableBudgetCard, {
      props: { dashboard: { ...v2Base, dueMayBeIncomplete: true } },
      global: { stubs },
    });
    expect(normalize(wrapper.text())).toContain('Сумма может быть неполной');
  });
```

- Change the expectation in `'shows the period figures and days left from the server'` from `'до 9 октября · осталось 6 дней'` to not expecting the days-left caption (header owns it): replace that line with `expect(text).not.toContain('осталось 6 дней');`.

`DashboardOverviewPanel.test.ts` (new):

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DashboardOverviewPanel from './DashboardOverviewPanel.vue';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

const normalize = (value: string): string => value.replace(/\p{Zs}/gu, ' ');

const dashboard = {
  planModelVersion: 2,
  period: { start: '2026-10-10', end: '2026-10-24', periodId: 'p' },
  cycle: { start: '2026-10-10', end: '2026-11-09' },
  asOf: '2026-10-22',
  horizonEnd: '2026-11-09',
  spendable: { state: 'READY', amountMinor: '783766' },
  suggestedTarget: null,
  cashMinor: '64781339',
  currentBalanceMinor: '783766',
  mandatoryBalanceMinor: '2608957',
  mandatoryDueMinor: '7984300',
  mandatoryDueCurrentMinor: '4197300',
  mandatoryDueNextMinor: '3787000',
  otherProtectedMinor: '300000',
  protectedMinor: '2908957',
  freeToAssignMinor: '0',
  unbackedMinor: '0',
  mandatoryGapMinor: '0',
  mandatoryGapCurrentMinor: '0',
  mandatoryGapNextMinor: '0',
  dueMayBeIncomplete: false,
  nearestObligations: [],
  periodStats: null,
  envelopes: [],
  envelopesTotalMinor: '0',
  upcoming: [],
  accounts: [],
  protectedAssignments: [],
  warnings: [],
  onboarding: {
    categoriesSeeded: true,
    hasAccounts: true,
    needsOpeningAssignment: false,
    needsPeriodSetup: false,
    hasMandatoryPlans: true,
    mandatoryPlansDeclined: false,
  },
} satisfies DashboardV2Response;

describe('DashboardOverviewPanel', () => {
  it('lists cash, protected money and the spendable amount from the server', () => {
    const text = normalize(mount(DashboardOverviewPanel, { props: { dashboard } }).text());
    expect(text).toContain('Общая картина');
    expect(text).toContain('На счетах');
    expect(text).toContain('647 813,39 ₽');
    expect(text).toContain('Отложено на платежи и накопления');
    expect(text).toContain('29 089,57 ₽');
    expect(text).toContain('Свободно для текущих трат');
    expect(text).toContain('7 837,66 ₽');
  });

  it('says the limit is not set instead of a zero', () => {
    const text = normalize(
      mount(DashboardOverviewPanel, {
        props: { dashboard: { ...dashboard, spendable: { state: 'NEEDS_PERIOD_SETUP', amountMinor: null } } },
      }).text(),
    );
    expect(text).toContain('Лимит не настроен');
  });

  it('reveals the breakdown on request with valid aria wiring and dl markup', async () => {
    const wrapper = mount(DashboardOverviewPanel, { props: { dashboard } });
    const toggle = wrapper.get('[data-action="toggle-breakdown"]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(toggle.attributes('aria-controls')).toBeUndefined();
    expect(wrapper.text()).not.toContain('Уже отложено на платежи и накопления');

    await toggle.trigger('click');
    const target = toggle.attributes('aria-controls');
    expect(target).toBeTruthy();
    expect(wrapper.find(`#${target}`).exists()).toBe(true);
    const text = normalize(wrapper.text());
    expect(text).toContain('Остаток текущего периода');
    expect(text).toContain('К оплате до 9 ноября');
    expect(text).toContain('79 843,00 ₽');
    expect(text).toContain('Уже отложено на платежи и накопления');
    expect(text).toContain('Конверты только показывают их назначение');
    for (const dl of wrapper.findAll('dl')) {
      for (const child of Array.from(dl.element.children)) {
        expect(['DIV', 'DT', 'DD']).toContain(child.tagName);
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/dashboard`
Expected: FAIL (missing component, prop, changed texts).

- [ ] **Step 3: `FinancialMonthTimeline.vue`**

Add `embedded?: boolean` to props (`withDefaults(..., { embedded: false })`), root `:class="{ 'fm-timeline--embedded': embedded }"`, hide the title paragraph when embedded (`v-if="!embedded"`; the track's `aria-label` already names the month), and style:

```css
.fm-timeline--embedded {
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
}
```

- [ ] **Step 4: `AvailableBudgetCard.vue`**

- Remove `emit`/`defineEmits`, `hasFreeMoney`, `hasGap`, `horizonLabel`, `periodCaption`, `daysLeftLabel`, `breakdownOpen`, the free row, the gap flag, the toggle and the breakdown block, and unused icon imports (`ChevronDown`, `ChevronUp`, `CircleAlert`; keep `TriangleAlert`).
- Replace the "В конверте периода" caption with:

```vue
      <p class="available-budget__caption">
        {{ deadlineLabel }} · доступно в текущем конверте
      </p>
      <FinancialMonthTimeline
        class="available-budget__timeline"
        embedded
        :cycle="dashboard.cycle"
        :period="dashboard.period"
        :as-of="dashboard.asOf"
      />
```

with `const deadlineLabel = computed(() => formatUntil(props.dashboard.period.end).replace(/^до/, 'До'));` and `import FinancialMonthTimeline from './FinancialMonthTimeline.vue';`.
- Root style: drop `border`, `border-radius`, `background`, `box-shadow`; keep `display: grid; gap; padding: var(--hf-card-padding)`. Add `.available-budget__stats` stays as is; `.available-budget__timeline { margin-block: var(--hf-space-2); }`.

- [ ] **Step 5: `DashboardOverviewPanel.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDown, ChevronUp } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'DashboardOverviewPanel' });

// Every amount is shown as the server sent it; the rows are not an equation.
const props = defineProps<{ dashboard: DashboardV2Response }>();

const monthFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
function formatUntil(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return `до ${monthFormatter.format(new Date(year, month - 1, day))}`;
}

const ready = computed(() => props.dashboard.spendable.state === 'READY');
const horizonLabel = computed(() => formatUntil(props.dashboard.horizonEnd));
const breakdownOpen = ref(false);
</script>

<template>
  <section class="overview" aria-labelledby="dashboard-overview-title">
    <h2 id="dashboard-overview-title" class="overview__title">Общая картина</h2>
    <dl class="overview__rows">
      <div>
        <dt>На счетах</dt>
        <dd><FinanceMoney :minor-units="dashboard.cashMinor" currency="RUB" :scale="2" /></dd>
      </div>
      <div>
        <dt>Отложено на платежи и накопления</dt>
        <dd><FinanceMoney :minor-units="dashboard.protectedMinor" currency="RUB" :scale="2" /></dd>
      </div>
      <div class="overview__row--accent">
        <dt>Свободно для текущих трат</dt>
        <dd>
          <FinanceMoney
            v-if="ready"
            :minor-units="dashboard.spendable.amountMinor ?? '0'"
            currency="RUB"
            :scale="2"
          />
          <span v-else>Лимит не настроен</span>
        </dd>
      </div>
    </dl>

    <button
      type="button"
      class="overview__toggle"
      data-action="toggle-breakdown"
      :aria-expanded="breakdownOpen"
      :aria-controls="breakdownOpen ? 'dashboard-overview-breakdown' : undefined"
      @click="breakdownOpen = !breakdownOpen"
    >
      Как рассчитано
      <component :is="breakdownOpen ? ChevronUp : ChevronDown" :size="16" aria-hidden="true" />
    </button>
    <div v-if="breakdownOpen" id="dashboard-overview-breakdown" class="overview__breakdown">
      <dl class="overview__list">
        <div>
          <dt>Остаток текущего периода</dt>
          <dd>
            <FinanceMoney :minor-units="dashboard.currentBalanceMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
        <div>
          <dt>К оплате {{ horizonLabel }}</dt>
          <dd>
            <FinanceMoney :minor-units="dashboard.mandatoryDueMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
      </dl>
      <h3 class="overview__group">Уже отложено на платежи и накопления</h3>
      <dl class="overview__list">
        <div>
          <dt>Отложено на обязательные платежи</dt>
          <dd>
            <FinanceMoney :minor-units="dashboard.mandatoryBalanceMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
        <div>
          <dt>Накопления и прочее</dt>
          <dd>
            <FinanceMoney :minor-units="dashboard.otherProtectedMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
        <div>
          <dt>Не распределено</dt>
          <dd>
            <FinanceMoney :minor-units="dashboard.freeToAssignMinor" currency="RUB" :scale="2" />
          </dd>
        </div>
      </dl>
      <p class="overview__note">
        Деньги находятся на счетах. Конверты только показывают их назначение.
      </p>
    </div>
  </section>
</template>

<style scoped>
.overview {
  display: grid;
  align-content: start;
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  background: var(--hf-color-surface-subtle);
}

.overview__title,
.overview__group {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  font-weight: var(--hf-font-weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.overview__group {
  letter-spacing: normal;
  text-transform: none;
}

.overview__rows,
.overview__list {
  display: grid;
  margin: 0;
}

.overview__rows > div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
  padding-block: var(--hf-space-3);
  border-bottom: 1px solid var(--hf-color-border);
}

.overview__list {
  gap: var(--hf-space-2);
}

.overview__list > div {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
  font-size: var(--hf-font-size-small);
}

.overview dt {
  color: var(--hf-color-text-muted);
}

.overview dd {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.overview__row--accent dt,
.overview__row--accent dd {
  color: var(--hf-color-action-primary-text);
}

.overview__toggle {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  justify-self: start;
  min-height: 2.75rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--hf-color-action-primary-text);
  font: inherit;
  font-weight: var(--hf-font-weight-medium);
  cursor: pointer;
}

.overview__toggle:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}

.overview__breakdown {
  display: grid;
  gap: var(--hf-space-3);
  padding: var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface);
}

.overview__note {
  margin: 0;
  padding-top: var(--hf-space-2);
  border-top: 1px solid var(--hf-color-border);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}
</style>
```

The accent row is the primary-text teal (`--hf-color-action-primary-text`, already ≥ 4.5:1 per `DashboardWarnings`) — brand colour marks the main answer, not a status.

- [ ] **Step 6: Run to verify pass**

Run: command from Step 2. Expected: PASS for these three files (page tests may fail until Task 9).

- [ ] **Step 7: Stage.** Commit: `feat(web): hero дашборда из двух панелей со шкалой месяца`.

---

### Task 5: Web — attention block

**Files:**
- Modify: `apps/web/app/components/dashboard/DashboardWarnings.vue`
- Modify: `apps/web/app/components/dashboard/DashboardWarnings.test.ts`

**Interfaces:**
- Consumes: `UiAttentionRow` (`tone`, `title`, `description`, `actionLabel`, `actionTo`, `plain`, emits `action`), `formatMoneyText` from `../envelopes/envelope-plan-kind.js`.
- Produces: props `{ v2Warnings: ReadonlyArray<V2Warning>; freeToAssignMinor: string }`, emits `assign: []`. Each row wrapper `<li data-testid="attention-row" :data-code="row.code">`; the free-money row has `data-code="FREE_MONEY"`.

- [ ] **Step 1: Replace tests** with:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DashboardWarnings from './DashboardWarnings.vue';

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  template: '<a :href="to"><slot /></a>',
};
const normalize = (value: string): string => value.replace(/\p{Zs}/gu, ' ');

type Code = 'MANDATORY_GAP' | 'CASH_SHORTFALL' | 'PERIOD_DEFICIT' | 'PERIOD_LEFTOVER';
const warning = (code: Code, actionPath: string, level?: 'ALERT' | 'INFO', index = 0) => ({
  kind: code.startsWith('PERIOD') ? ('PERIOD' as const) : ('COVERAGE' as const),
  code,
  message: `Серверный текст ${code} ${index}`,
  amountMinor: '1000000',
  envelopeId: null,
  periodId: null,
  balanceMinor: null,
  actionPath,
  ...(level ? { level } : {}),
});
const mountWarnings = (v2Warnings: ReturnType<typeof warning>[], freeToAssignMinor = '0') =>
  mount(DashboardWarnings, {
    props: { v2Warnings, freeToAssignMinor },
    global: { stubs: { NuxtLink: NuxtLinkStub } },
  });

describe('DashboardWarnings', () => {
  it.each([
    ['MANDATORY_GAP', 'ALERT', 'warning', 'Не хватает на обязательные платежи', 'Покрыть'],
    ['MANDATORY_GAP', 'INFO', 'info', 'Заложите на следующий период', 'Покрыть'],
    ['MANDATORY_GAP', undefined, 'warning', 'Не хватает на обязательные платежи', 'Покрыть'],
    ['CASH_SHORTFALL', undefined, 'danger', 'Не хватает денег на счетах', 'Проверить счета'],
  ] as const)('%s %s: tone %s, title, server text and server link', (code, level, tone, title, label) => {
    const wrapper = mountWarnings([warning(code, '/server/path', level)]);
    const row = wrapper.get('.ui-attention-row');
    expect(row.classes()).toContain(`ui-attention-row--${tone}`);
    expect(row.text()).toContain(title);
    expect(row.text()).toContain(`Серверный текст ${code}`);
    const link = row.get('a');
    expect(link.text()).toBe(label);
    expect(link.attributes('href')).toBe('/server/path');
  });

  it('leaves period warnings to the period decision card', () => {
    const wrapper = mountWarnings([
      warning('PERIOD_LEFTOVER', '/a'),
      warning('PERIOD_DEFICIT', '/b'),
    ]);
    expect(wrapper.find('section').exists()).toBe(false);
  });

  it('offers to assign free income with the server amount and emits assign', async () => {
    const wrapper = mountWarnings([], '1200000');
    const row = wrapper.get('[data-code="FREE_MONEY"]');
    expect(normalize(row.text())).toContain('Есть нераспределённый доход');
    expect(normalize(row.text())).toContain('12 000,00 ₽ можно направить в конверты');
    await row.get('button').trigger('click');
    expect(wrapper.emitted('assign')).toHaveLength(1);
  });

  it('shows no free income row for zero or negative amounts', () => {
    expect(mountWarnings([], '0').find('section').exists()).toBe(false);
    expect(mountWarnings([], '-100').find('section').exists()).toBe(false);
  });

  it('keeps rows with identical codes distinct and names the block for screen readers', () => {
    const wrapper = mountWarnings([
      warning('MANDATORY_GAP', '/a', 'ALERT', 0),
      warning('MANDATORY_GAP', '/b', 'ALERT', 1),
    ]);
    expect(wrapper.findAll('[data-testid="attention-row"]')).toHaveLength(2);
    const section = wrapper.get('section');
    expect(wrapper.get(`#${section.attributes('aria-labelledby')}`).text()).toBe('Требует внимания');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/dashboard/DashboardWarnings.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `DashboardWarnings.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';

import UiAttentionRow from '../ui/AttentionRow.vue';
import { formatMoneyText } from '../envelopes/envelope-plan-kind.js';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'DashboardWarnings' });

type V2Warning = DashboardV2Response['warnings'][number];
type Row = {
  key: string;
  code: V2Warning['code'] | 'FREE_MONEY';
  tone: 'info' | 'warning' | 'danger';
  title: string;
  description: string;
  actionLabel: string;
  actionTo?: string;
};

// Server texts and paths; the page decides what "assign" opens.
const props = defineProps<{
  v2Warnings: ReadonlyArray<V2Warning>;
  freeToAssignMinor: string;
}>();
const emit = defineEmits<{ assign: [] }>();

const rows = computed<Row[]>(() => {
  const list: Row[] = [];
  props.v2Warnings.forEach((warning, index) => {
    const key = `${warning.code}-${warning.periodId ?? warning.envelopeId ?? index}`;
    if (warning.code === 'MANDATORY_GAP') {
      // A missing level means the current period is affected: treat it as ALERT.
      const info = warning.level === 'INFO';
      list.push({
        key,
        code: warning.code,
        tone: info ? 'info' : 'warning',
        title: info ? 'Заложите на следующий период' : 'Не хватает на обязательные платежи',
        description: warning.message,
        actionLabel: 'Покрыть',
        actionTo: warning.actionPath,
      });
    } else if (warning.code === 'CASH_SHORTFALL') {
      list.push({
        key,
        code: warning.code,
        tone: 'danger',
        title: 'Не хватает денег на счетах',
        description: warning.message,
        actionLabel: 'Проверить счета',
        actionTo: warning.actionPath,
      });
    }
  });
  const free = props.freeToAssignMinor;
  if (free !== '0' && !free.startsWith('-')) {
    list.push({
      key: 'FREE_MONEY',
      code: 'FREE_MONEY',
      tone: 'info',
      title: 'Есть нераспределённый доход',
      description: `${formatMoneyText(free)} можно направить в конверты`,
      actionLabel: 'Распределить',
    });
  }
  return list;
});
</script>

<template>
  <section
    v-if="rows.length > 0"
    class="dashboard-warnings"
    data-testid="dashboard-warnings"
    aria-labelledby="dashboard-warnings-title"
  >
    <h2 id="dashboard-warnings-title" class="dashboard-warnings__title">Требует внимания</h2>
    <ul class="dashboard-warnings__list">
      <li
        v-for="row in rows"
        :key="row.key"
        class="dashboard-warnings__item"
        data-testid="attention-row"
        :data-code="row.code"
      >
        <UiAttentionRow
          plain
          :tone="row.tone"
          :title="row.title"
          :description="row.description"
          :action-label="row.actionLabel"
          :action-to="row.actionTo"
          @action="emit('assign')"
        />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.dashboard-warnings {
  padding: 0 var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

/* Visually hidden, still announced: the rows carry their own titles. */
.dashboard-warnings__title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.dashboard-warnings__list {
  display: grid;
  grid-template-columns: 1fr;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dashboard-warnings__item + .dashboard-warnings__item {
  border-top: 1px solid var(--hf-color-border);
}

@media (min-width: 1024px) {
  .dashboard-warnings__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--hf-space-5);
  }

  .dashboard-warnings__item + .dashboard-warnings__item {
    border-top: 0;
  }

  .dashboard-warnings__item:nth-child(even) {
    padding-left: var(--hf-space-5);
    border-left: 1px solid var(--hf-color-border);
  }

  .dashboard-warnings__item:nth-child(n + 3) {
    border-top: 1px solid var(--hf-color-border);
  }
}
</style>
```

`UiAttentionRow` emits `action` only from its `<button>` (rows without `actionTo`), so only the free-money row can emit `assign`.

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Stage.** Commit: `feat(web): блок «Требует внимания» в две колонки`.

---

### Task 6: Web — nearest obligations card

**Files:**
- Modify: `apps/web/app/components/dashboard/UpcomingObligations.vue`
- Modify: `apps/web/app/components/dashboard/UpcomingObligations.test.ts`
- Modify: `apps/web/app/assets/styles/tokens.css` (one alias token)

**Interfaces:**
- Consumes: `DashboardV2Response['nearestObligations']` with `coverage`, `shortfallMinor` (Task 3); `formatMoneyText` from `../envelopes/envelope-plan-kind.js`.
- Produces: CSS token `--hf-color-text-success`.
- Produces: same props `{ items }`.

- [ ] **Step 1: Replace tests** with:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UpcomingObligations from './UpcomingObligations.vue';

const normalize = (value: string): string => value.replace(/\p{Zs}/gu, ' ');
const item = (over: Partial<Record<string, string>> = {}) => ({
  occurrenceId: 'occurrence-id',
  name: 'Ипотека',
  scheduledOn: '2026-10-26',
  unpaidMinor: '3597300',
  coverage: 'COVERED' as 'COVERED' | 'PARTIAL' | 'UNCOVERED',
  shortfallMinor: '0',
  ...over,
});
const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };
const mountList = (items: ReturnType<typeof item>[]) =>
  mount(UpcomingObligations, { props: { items }, global: { stubs } });

describe('UpcomingObligations', () => {
  it('renders the whole row as one plan link with a date tile, amount and one accessible name', () => {
    const wrapper = mountList([item()]);
    const link = wrapper.get('a[href="/app/plans?occurrence=occurrence-id"]');
    const text = normalize(link.text());
    expect(text).toContain('Ипотека');
    expect(text).toContain('35 973,00 ₽');
    expect(text).toContain('26');
    expect(text).not.toContain('2026-10-26');
    expect(normalize(link.attributes('aria-label') ?? '')).toBe(
      'Ипотека, 26 октября, 35 973,00 ₽, отложено полностью',
    );
    expect(link.find('a, button').exists()).toBe(false);
    const all = wrapper.get('a[href="/app/plans"]');
    expect(all.text()).toContain('Все планы');
  });

  it.each([
    ['COVERED', '0', 'Отложено полностью'],
    ['PARTIAL', '1100000', 'Нужно пополнить 11 000,00 ₽'],
    ['UNCOVERED', '3597300', 'Не отложено'],
  ] as const)('shows %s coverage as icon plus text', (coverage, shortfallMinor, label) => {
    const wrapper = mountList([item({ coverage, shortfallMinor })]);
    const status = wrapper.get('[data-testid="obligation-status"]');
    expect(normalize(status.text())).toBe(label);
    expect(status.find('svg[aria-hidden="true"]').exists()).toBe(true);
  });

  it('renders the empty state', () => {
    expect(mountList([]).text()).toContain('Ближайших обязательных платежей нет.');
  });
});
```

- [ ] **Step 2: Run to verify failure.** `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/dashboard/UpcomingObligations.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

```vue
<script setup lang="ts">
import { ArrowRight, Check, CircleAlert } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import UiMoreLink from '../ui/MoreLink.vue';
import { formatMoneyText } from '../envelopes/envelope-plan-kind.js';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

type Obligation = DashboardV2Response['nearestObligations'][number];

defineProps<{ items: ReadonlyArray<Obligation> }>();

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const monthFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'short' });

function toDate(iso: string): Date | null {
  const [year, month, day] = iso.split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
}
function dayOf(iso: string): string {
  return String(toDate(iso)?.getDate() ?? iso);
}
function monthOf(iso: string): string {
  const date = toDate(iso);
  return date ? monthFormatter.format(date).replace('.', '') : '';
}
function fullDate(iso: string): string {
  const date = toDate(iso);
  return date ? dateFormatter.format(date) : iso;
}
function statusText(item: Obligation): string {
  if (item.coverage === 'COVERED') return 'Отложено полностью';
  if (item.coverage === 'PARTIAL') return `Нужно пополнить ${formatMoneyText(item.shortfallMinor)}`;
  return 'Не отложено';
}
function accessibleName(item: Obligation): string {
  return `${item.name}, ${fullDate(item.scheduledOn)}, ${formatMoneyText(item.unpaidMinor)}, ${statusText(item).toLowerCase()}`;
}
</script>

<template>
  <section class="obligations" aria-labelledby="upcoming-obligations-title">
    <header class="obligations__header">
      <div>
        <h2 id="upcoming-obligations-title" class="obligations__title">
          Ближайшие обязательные платежи
        </h2>
        <p class="obligations__subtitle">На ближайшие 60 дней</p>
      </div>
      <UiMoreLink to="/app/plans">Все планы</UiMoreLink>
    </header>
    <p v-if="items.length === 0" class="obligations__empty">
      Ближайших обязательных платежей нет.
    </p>
    <ul v-else class="obligations__list">
      <li v-for="item in items" :key="item.occurrenceId" class="obligations__item">
        <NuxtLink
          class="obligations__link"
          :to="`/app/plans?occurrence=${item.occurrenceId}`"
          :aria-label="accessibleName(item)"
        >
          <span class="obligations__date" aria-hidden="true">
            <span class="obligations__day">{{ dayOf(item.scheduledOn) }}</span>
            <span class="obligations__month">{{ monthOf(item.scheduledOn) }}</span>
          </span>
          <span class="obligations__body">
            <span class="obligations__name">{{ item.name }}</span>
            <span
              class="obligations__status"
              :class="item.coverage === 'COVERED' ? 'obligations__status--ok' : 'obligations__status--warning'"
              data-testid="obligation-status"
            >
              <Check v-if="item.coverage === 'COVERED'" :size="14" aria-hidden="true" />
              <CircleAlert v-else :size="14" aria-hidden="true" />
              {{ statusText(item) }}
            </span>
          </span>
          <FinanceMoney class="obligations__amount" :minor-units="item.unpaidMinor" currency="RUB" :scale="2" />
          <ArrowRight class="obligations__arrow" :size="16" aria-hidden="true" />
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.obligations {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.obligations__header {
  display: flex;
  gap: var(--hf-space-3);
  align-items: flex-start;
  justify-content: space-between;
}

.obligations__title {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}

.obligations__subtitle,
.obligations__empty {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
}

.obligations__list {
  display: grid;
  grid-template-columns: 1fr;
  margin: 0;
  padding: 0;
  list-style: none;
}

.obligations__item + .obligations__item {
  border-top: 1px solid var(--hf-color-border);
}

@media (min-width: 768px) {
  .obligations__list {
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  }

  .obligations__item + .obligations__item {
    border-top: 0;
    border-left: 1px solid var(--hf-color-border);
  }
}

.obligations__link {
  display: flex;
  gap: var(--hf-space-3);
  align-items: center;
  min-height: 2.75rem;
  padding: var(--hf-space-3);
  border-radius: var(--hf-radius-md);
  color: inherit;
  text-decoration: none;
}

.obligations__link:hover {
  background: var(--hf-color-surface-subtle);
}

.obligations__link:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
}

.obligations__date {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  line-height: 1;
}

.obligations__day {
  font-weight: var(--hf-font-weight-bold);
}

.obligations__month {
  color: var(--hf-color-text-muted);
  font-size: 0.625rem;
}

.obligations__body {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
}

.obligations__name {
  overflow: hidden;
  font-weight: var(--hf-font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.obligations__status {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  font-size: var(--hf-font-size-caption);
}

.obligations__status--ok {
  color: var(--hf-color-text-success);
}

.obligations__status--warning {
  color: var(--hf-color-status-warning);
}

.obligations__amount {
  flex-shrink: 0;
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.obligations__arrow {
  flex-shrink: 0;
  color: var(--hf-color-text-muted);
}
</style>
```

Add a text-grade success token to `apps/web/app/assets/styles/tokens.css`, next to `--hf-color-status-success` in the light block (once; the dark theme inherits through its `--hf-color-account-cash` override `#5fd09b`):

```css
  /* Text-grade green: status-success #22a06b is only ~3.3:1 on white; account-cash is 4.5:1+ in both themes. */
  --hf-color-text-success: var(--hf-color-account-cash);
```

`--hf-color-status-warning` (`#92400e` light / `#f0a94e` dark) is already text-grade.

- [ ] **Step 4: Run to verify pass.** Expected: PASS.

- [ ] **Step 5: Stage.** Commit: `feat(web): ближайшие платежи со статусом покрытия`.

---

### Task 7: Web — balance lists and envelope progress

**Files:**
- Modify: `apps/web/app/components/dashboard/BalanceList.vue`
- Modify: `apps/web/app/components/dashboard/BalanceList.test.ts`
- Create: `apps/web/app/components/dashboard/DashboardEnvelopeRow.vue`
- Create: `apps/web/app/components/dashboard/DashboardEnvelopeRow.test.ts`

**Interfaces:**
- Consumes: `UiProgress` (`value`, `max`, `label`, `tone`), `EnvelopeTypeIcon`, `envelopeTone` from `../envelopes/envelope-plan-kind.js`, `envelopeSubtitle` from `../envelopes/envelope-type.js`, `formatMoneyText`.
- Produces:
  - `BalanceList` new props `subtitle: string`, `moreLabel: string` (link text, e.g. «Все счета»); title is an `h2` card heading.
  - `DashboardEnvelopeRow` props `{ envelope: DashboardV2Response['envelopes'][number] }` — renders icon, name, subtitle/status, amount, optional progress.

- [ ] **Step 1: Failing tests**

`BalanceList.test.ts` — update mounts to pass `subtitle: 'Где находятся деньги'`, `moreLabel: 'Все счета'` and add:

```ts
  it('names the card with a heading, subtitle and a labelled "all" link', () => {
    const wrapper = mount(BalanceList, {
      props: {
        title: 'Счета',
        subtitle: 'Где находятся деньги',
        moreLabel: 'Все счета',
        items: [],
        totalMinor: '0',
        moreLink: '/app/accounts',
      },
      global: { stubs },
    });
    expect(wrapper.get('h2').text()).toBe('Счета');
    expect(wrapper.text()).toContain('Где находятся деньги');
    expect(wrapper.get('a[href="/app/accounts"]').text()).toContain('Все счета');
  });
```

(Reuse the file's existing `stubs`/`NuxtLink` stub; if it has none, add `const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };`.) Replace any assertion on the old link text `'Все'` / `aria-label="Все: …"` with the new label.

`DashboardEnvelopeRow.test.ts` (new):

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DashboardEnvelopeRow from './DashboardEnvelopeRow.vue';

const normalize = (value: string): string => value.replace(/\p{Zs}/gu, ' ');
const base = {
  id: 'e',
  name: 'Обязательные платежи',
  envelopeType: 'MANDATORY_EXPENSES',
  periodSlot: null,
  balanceMinor: '2608957',
  progress: null,
} as const;

describe('DashboardEnvelopeRow', () => {
  it('shows a coverage bar in the type colour and the server shortfall', () => {
    const wrapper = mount(DashboardEnvelopeRow, {
      props: {
        envelope: {
          ...base,
          progress: { kind: 'COVERED', valueMinor: '2608957', maxMinor: '7984300', shortfallMinor: '5375343' },
        },
      },
    });
    const bar = wrapper.get('[role="progressbar"]');
    expect(bar.attributes('aria-label')).toBe('Покрыто ближайших платежей');
    expect(bar.attributes('aria-valuenow')).toBe('32');
    expect(wrapper.find('.ui-progress__fill--mandatory').exists()).toBe(true);
    expect(normalize(wrapper.text())).toContain('Нужно пополнить 53 753,43 ₽');
    expect(normalize(wrapper.text())).toContain('26 089,57 ₽');
  });

  it('says fully set aside when nothing is short', () => {
    const wrapper = mount(DashboardEnvelopeRow, {
      props: {
        envelope: {
          ...base,
          progress: { kind: 'COVERED', valueMinor: '9000000', maxMinor: '7984300', shortfallMinor: '0' },
        },
      },
    });
    expect(wrapper.text()).toContain('Отложено полностью');
  });

  it('keeps the type subtitle for spent and goal bars', () => {
    const wrapper = mount(DashboardEnvelopeRow, {
      props: {
        envelope: {
          ...base,
          name: 'Автомобиль',
          envelopeType: 'SAVINGS_GOAL',
          balanceMinor: '300000',
          progress: { kind: 'GOAL', valueMinor: '300000', maxMinor: '2000000', shortfallMinor: null },
        },
      },
    });
    expect(wrapper.get('[role="progressbar"]').attributes('aria-label')).toBe('Цель');
    expect(wrapper.find('.ui-progress__fill--savings').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Нужно пополнить');
  });

  it('renders no bar without progress', () => {
    const wrapper = mount(DashboardEnvelopeRow, { props: { envelope: base } });
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/dashboard/BalanceList.test.ts app/components/dashboard/DashboardEnvelopeRow.test.ts`. Expected: FAIL.

- [ ] **Step 3: `BalanceList.vue`**

Props add `subtitle: string; moreLabel: string`. Header:

```vue
    <header class="balance-list__header">
      <div>
        <h2 class="balance-list__title">{{ title }}</h2>
        <p class="balance-list__subtitle">{{ subtitle }}</p>
      </div>
      <UiMoreLink :to="moreLink">{{ moreLabel }}</UiMoreLink>
    </header>
```

Styles: `.balance-list__title { margin: 0; font-size: var(--hf-font-size-h3); line-height: var(--hf-line-height-h3); }` (drop uppercase/muted), `.balance-list__subtitle { margin: 0; color: var(--hf-color-text-muted); font-size: var(--hf-font-size-caption); }`, `.balance-list__list { gap: 0; }`, `.balance-list__row + .balance-list__row { border-top: 1px solid var(--hf-color-border); }`, `.balance-list__row { padding: var(--hf-space-3) 0; }`, and add `border-top: 1px solid var(--hf-color-border); padding-top: var(--hf-space-1);` to `.balance-list__list`. Replace `border-radius: var(--hf-card-radius)` / `box-shadow: var(--hf-shadow-card)` only if they differ from the card rule; keep as is otherwise.

- [ ] **Step 4: `DashboardEnvelopeRow.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { CircleAlert } from '@lucide/vue';

import EnvelopeTypeIcon from '../envelopes/EnvelopeTypeIcon.vue';
import { envelopeTone, formatMoneyText } from '../envelopes/envelope-plan-kind.js';
import { envelopeSubtitle } from '../envelopes/envelope-type.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiProgress from '../ui/Progress.vue';
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';

defineOptions({ name: 'DashboardEnvelopeRow' });

const props = defineProps<{ envelope: DashboardV2Response['envelopes'][number] }>();

const PROGRESS_LABELS = {
  SPENT: 'Потрачено из отложенного',
  COVERED: 'Покрыто ближайших платежей',
  GOAL: 'Цель',
} as const;

const progress = computed(() => props.envelope.progress);
const shortfall = computed(() => {
  const value = progress.value?.kind === 'COVERED' ? progress.value.shortfallMinor : null;
  return value !== null && value !== '0' ? value : null;
});
const subtitle = computed(() => {
  if (progress.value?.kind === 'COVERED' && shortfall.value === null) return 'Отложено полностью';
  return envelopeSubtitle(props.envelope);
});
</script>

<template>
  <span class="envelope-row">
    <EnvelopeTypeIcon :envelope-type="envelope.envelopeType" size="sm" />
    <span class="envelope-row__body">
      <span class="envelope-row__head">
        <span class="envelope-row__name">{{ envelope.name }}</span>
        <FinanceMoney
          class="envelope-row__amount"
          :minor-units="envelope.balanceMinor"
          currency="RUB"
          :scale="2"
        />
      </span>
      <span v-if="shortfall" class="envelope-row__subtitle envelope-row__subtitle--warning">
        <CircleAlert :size="14" aria-hidden="true" />
        Нужно пополнить {{ formatMoneyText(shortfall) }}
      </span>
      <span v-else class="envelope-row__subtitle">{{ subtitle }}</span>
      <UiProgress
        v-if="progress"
        class="envelope-row__progress"
        :value="progress.valueMinor"
        :max="progress.maxMinor"
        :label="PROGRESS_LABELS[progress.kind]"
        :tone="envelopeTone(envelope.envelopeType)"
      />
    </span>
  </span>
</template>

<style scoped>
.envelope-row {
  display: flex;
  flex: 1;
  gap: var(--hf-space-3);
  align-items: flex-start;
  min-width: 0;
}

.envelope-row__body {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
}

.envelope-row__head {
  display: flex;
  gap: var(--hf-space-3);
  justify-content: space-between;
}

.envelope-row__name {
  overflow: hidden;
  font-weight: var(--hf-font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.envelope-row__amount {
  flex-shrink: 0;
  font-weight: var(--hf-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.envelope-row__subtitle {
  display: inline-flex;
  gap: var(--hf-space-1);
  align-items: center;
  overflow: hidden;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.envelope-row__subtitle--warning {
  color: var(--hf-color-status-warning);
}

.envelope-row__progress {
  height: 0.375rem;
  margin-top: var(--hf-space-2);
}
</style>
```

Check `envelopeSubtitle`'s parameter type accepts the dashboard envelope row (it is already called with `DashboardV2Response['envelopes'][number]` in `pages/app/index.vue`); keep that call shape.

- [ ] **Step 5: Run to verify pass.** Expected: PASS.

- [ ] **Step 6: Stage.** Commit: `feat(web): шкалы конвертов и заголовки списков на дашборде`.

---

### Task 8: Web — recent operations grouped by day

**Files:**
- Modify: `apps/web/app/components/dashboard/RecentOperations.vue`
- Modify: `apps/web/app/components/dashboard/RecentOperations.test.ts`

**Interfaces:**
- Consumes: `OperationGroup` (`label` prop, renders `<ul>` with slot), `OperationRow` (unchanged).
- Produces: new required prop `asOf: string` (ISO date of the server dashboard).

- [ ] **Step 1: Failing test** — in `RecentOperations.test.ts` pass `asOf: '2026-10-22'` in every mount and add (use the file's existing transaction factory; ensure two items on `2026-10-22`, one on `2026-10-21`, one on `2026-10-15` via its `occurredOn` field):

```ts
  it('groups operations by the server day: today, yesterday, then the date', () => {
    const wrapper = mountRecent([
      tx({ id: 'a', occurredOn: '2026-10-22' }),
      tx({ id: 'b', occurredOn: '2026-10-22' }),
      tx({ id: 'c', occurredOn: '2026-10-21' }),
      tx({ id: 'd', occurredOn: '2026-10-15' }),
    ]);
    const labels = wrapper.findAll('[data-testid="operation-group-label"]').map((node) => node.text());
    expect(labels).toEqual(['Сегодня', 'Вчера', '15 октября']);
    expect(wrapper.findAll('ul')[0]!.findAll('li')).toHaveLength(2);
  });
```

If the file has no `tx`/`mountRecent` helpers, extract them from its existing fixture and `mount` call first (same props plus `asOf`). Confirm the journal item date field name in `TransactionJournalV2Item` (`occurredOn`); use that name throughout.

- [ ] **Step 2: Run to verify failure.** Expected: FAIL.

- [ ] **Step 3: Implement**

Script additions:

```ts
import OperationGroup from '../operations/OperationGroup.vue';
import { formatDayMonth } from '../envelopes/envelope-plan-kind.js';

// props: add `asOf: string;`

function previousDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

// Journal order is newest first: consecutive items of one day form one group.
const groups = computed(() => {
  const yesterday = previousDay(props.asOf);
  const list: Array<{ key: string; label: string; items: TransactionJournalV2Item[] }> = [];
  for (const transaction of props.transactions) {
    const key = transaction.occurredOn;
    const last = list[list.length - 1];
    if (last && last.key === key) {
      last.items.push(transaction);
      continue;
    }
    const label =
      key === props.asOf ? 'Сегодня' : key === yesterday ? 'Вчера' : formatDayMonth(key);
    list.push({ key, label, items: [transaction] });
  }
  return list;
});
```

Template: replace the `<ul v-else class="recent-operations__list">…</ul>` with

```vue
    <div v-else class="recent-operations__groups">
      <OperationGroup v-for="group in groups" :key="group.key" :label="group.label">
        <li v-for="transaction in group.items" :key="transaction.id" class="recent-operations__item">
          <OperationRow
            :transaction="transaction"
            :category-name="categoryName(transaction)"
            :category-icon="categoryIcon(transaction)"
            :account-name="accountName(transaction)"
            :envelope-name="envelopeName(transaction)"
            @select="openOperation(transaction.id)"
          />
        </li>
      </OperationGroup>
    </div>
```

Header: `<h2>` stays «Последние операции»; add `<p class="recent-operations__subtitle">Последние изменения семейного бюджета</p>` under it inside a `<div>`. Styles: add card border `border: 1px solid var(--hf-color-border);`, `.recent-operations__groups { display: grid; gap: var(--hf-space-4); }`, `.recent-operations__item { min-width: 0; }`, subtitle muted caption; remove `.recent-operations__list` rules.

- [ ] **Step 4: Run to verify pass.** Expected: PASS.

- [ ] **Step 5: Stage.** Commit: `feat(web): последние операции по дням`.

---

### Task 9: Web — page assembly

**Files:**
- Modify: `apps/web/app/pages/app/index.vue`
- Modify: `apps/web/app/pages/app/index.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–8.

- [ ] **Step 1: Update page tests**

In `index.test.ts`:
- Fixture: ensure `protectedMinor`, `coverage`/`shortfallMinor`, `progress` exist (Task 3).
- `'shows the financial month timeline from the server cycle and date'`: assert the timeline is inside the hero: `expect(wrapper.get('[data-testid="dashboard-hero"]').findComponent({ name: 'FinancialMonthTimeline' }).exists()).toBe(true)`, and add an assertion for the header subtitle, e.g. for a fixture period `2026-10-10…2026-10-24`, `cycle.start === period.start`, `daysLeft: 3`: `expect(normalize(wrapper.get('[data-testid="dashboard-period-line"]').text())).toBe('10–24 октября · первая половина периода · осталось 3 дня')` (adapt dates to the fixture's period; compute the expected string by hand, not with the helper).
- `'hides the unassigned row when no money is free'`: replace `[data-testid="envelopes-unassigned"]` with `[data-code="FREE_MONEY"]`.
- `'opens the free money assignment from the dashboard and refreshes after confirm'`: replace the click target with `wrapper.get('[data-code="FREE_MONEY"] button')`.
- Any assertion on `'Обязательные платежи'` heading text of the old obligations card → `'Ближайшие обязательные платежи'`.

Run: `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/pages/app/index.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement page**

Script:
- Remove imports/usages no longer needed: `AccountTypeIcon` stays, `EnvelopeTypeIcon`, `envelopeSubtitle`, `envelopeRow`, `envelopeSubtitleFor`, `hasFreeMoney` are removed (envelope rows use `DashboardEnvelopeRow`).
- Add imports: `Calendar` from `@lucide/vue`, `DashboardOverviewPanel`, `DashboardEnvelopeRow`, `periodRangeText` from `../../components/envelopes/envelope-plan-kind.js`.
- Add:

```ts
type DashboardEnvelope = DashboardV2Response['envelopes'][number];
function envelopeById(id: string): DashboardEnvelope {
  return dashboardV2.value!.envelopes.find((row) => row.id === id)!;
}

// Counts come from the server; this only picks the Russian word form.
function daysLeftLabel(days: number): string {
  const tail = days % 10;
  const teen = days % 100;
  if (tail === 1 && teen !== 11) return `осталось ${days} день`;
  if (tail >= 2 && tail <= 4 && (teen < 12 || teen > 14)) return `осталось ${days} дня`;
  return `осталось ${days} дней`;
}

const periodLine = computed(() => {
  const dashboard = dashboardV2.value;
  if (!dashboard) return '';
  const parts = [
    periodRangeText(dashboard.period.start, dashboard.period.end),
    dashboard.period.start === dashboard.cycle.start
      ? 'первая половина периода'
      : 'вторая половина периода',
  ];
  if (dashboard.periodStats) parts.push(daysLeftLabel(dashboard.periodStats.daysLeft));
  return parts.join(' · ');
});
```

Template changes:
- Header: under the `h1` add

```vue
          <p class="dashboard-period-line" data-testid="dashboard-period-line">
            <Calendar :size="16" aria-hidden="true" />
            {{ periodLine }}
          </p>
```

- Remove the standalone `<FinancialMonthTimeline class="dashboard-timeline" …/>` and its import.
- Replace `<DashboardWarnings :v2-warnings="coverageWarnings" />` with

```vue
        <DashboardWarnings
          :v2-warnings="coverageWarnings"
          :free-to-assign-minor="dashboardV2.freeToAssignMinor"
          @assign="funding.offer({ sourceKind: 'FREE' })"
        />
```

- Move `DashboardWarnings` **after** the hero (order: Onboarding, PeriodDecision, hero, warnings, obligations, lists, operations).
- Replace `.dashboard-hero-row` block with

```vue
        <section class="dashboard-hero" data-testid="dashboard-hero" aria-label="Сводка периода">
          <AvailableBudgetCard :dashboard="dashboardV2" />
          <DashboardOverviewPanel :dashboard="dashboardV2" />
        </section>
        <UpcomingObligations :items="dashboardV2.nearestObligations" />
```

- Accounts `BalanceList`: add `subtitle="Где находятся деньги"` `more-label="Все счета"`.
- Envelopes `BalanceList`: add `subtitle="Для чего назначены деньги"` `more-label="Все конверты"`; row slot becomes `<DashboardEnvelopeRow :envelope="envelopeById(item.id)" />`; delete the `#footer` slot.
- `RecentOperations`: add `:as-of="dashboardV2.asOf"`.

Styles:
- Remove `.dashboard-timeline`, `.dashboard-hero-row*`, `.dashboard-unassigned`.
- Add

```css
.dashboard-period-line {
  display: flex;
  gap: var(--hf-space-2);
  align-items: center;
  margin: var(--hf-space-2) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.dashboard-hero {
  display: grid;
  grid-template-columns: 1fr;
  overflow: hidden;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

@media (min-width: 1024px) {
  .dashboard-hero {
    grid-template-columns: 2fr 1fr;
  }

  .dashboard-hero > :last-child {
    border-left: 1px solid var(--hf-color-border);
  }
}

@media (max-width: 1023px) {
  .dashboard-hero > :last-child {
    border-top: 1px solid var(--hf-color-border);
  }
}
```

- `.dashboard-lists-row` stays (2 columns from 1024px).

- [ ] **Step 3: Run page and dashboard tests**

Run: `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/pages/app app/components/dashboard`. Expected: PASS.

- [ ] **Step 4: Stage.** Commit: `feat(web): новая раскладка дашборда`.

---

### Task 10: Guidelines note and full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-09-17-calm-fintech-visual-guidelines.md` (short section "Дашборд")

- [ ] **Step 1: Document the pattern**

Append under "Карточки и поверхности":

```markdown
### Дашборд (решение владельца 22.10.2026)

Раскладка — по прототипу Figma Make, см. [дизайн](2026-10-22-dashboard-redesign-design.md): шапка с строкой периода; hero — одна карточка из двух панелей («Можно потратить» со встроенной шкалой финансового месяца без процента и «Общая картина» на `surface-subtle`); «Требует внимания» — `UiAttentionRow` в две колонки; ближайшие платежи — карточка на всю ширину с плиткой даты и статусом покрытия (иконка + текст); конверты — `UiProgress` цветом типа по серверным `progress.valueMinor`/`maxMinor`; операции — по дням через `OperationGroup`. Строки «Общей картины» не складываются в уравнение: клиент не считает деньги.
```

- [ ] **Step 2: Run named checks**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @harmofin/api test:integration -- v2-dashboard
pnpm format:check
```

Expected: all PASS. Report unrelated failures without fixing them.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --stat main...HEAD` and `git diff` for staged changes; confirm no `identity/logo_description.png`, no client money arithmetic (`grep -n "BigInt\|parseFloat\|Number(.*Minor" apps/web/app/components/dashboard apps/web/app/pages/app/index.vue` shows nothing new).

- [ ] **Step 4: Manual scenario for CI/owner (no local Playwright)**

Light and dark theme; widths 375 / 768 / 1280; budget with mandatory gap + free income; budget with no period set up (hero invite, overview «Лимит не настроен», no SPENT bar).

- [ ] **Step 5: Reviews and stage.** Final review receipt; commit `docs: паттерн дашборда в визуальных гайдлайнах`.

## Review routing

| Task | Reviews |
| --- | --- |
| 1–2 | Financial, Security, API, QA, backend |
| 3 | API (contract types), QA |
| 4–9 | UI/UX, QA |
| 10 | Final |
