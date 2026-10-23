# Funding Sheet: All Envelopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The «Распределить деньги» sheet lists every active envelope (rule suggestions prefilled, others `0`), lets the owner put any amount in any envelope or zero out a suggestion, and shows the server-computed remainder while typing.

**Architecture:** The funding preview builds one line slot per active envelope *before* overrides are applied (rule queue first, then envelopes without a rule by name) and returns zero lines instead of dropping them, plus additive line fields `queuePosition`, `periodStartsOn`, `periodEndsOn`. Confirm accepts `amount = 0` lines: they take part in the preview-hash recompute but create no assignment. The web sheet renders all lines, treats an empty field as `0`, re-previews after a 400 ms typing pause, and never sums money.

**Tech Stack:** NestJS/Fastify, Prisma, zod, Vitest (+ integration against local PostgreSQL), Nuxt 4 / Vue 3.5, @vue/test-utils, Playwright (CI only).

**Spec:** [2026-10-23-funding-sheet-all-envelopes-design.md](../specs/2026-10-23-funding-sheet-all-envelopes-design.md)

## Global Constraints

- Money is integer minor units (`bigint`) on the server; the web never adds, subtracts or compares money amounts — it only formats server minor-unit strings and checks strings like `'0'`.
- Every query keeps `budgetId` filtering in the DB query; preview/confirm stay OWNER-only under the budget row lock.
- Confirm rules unchanged: income cap (L03), physically free cash (L02), idempotency, atomic transaction, `PREVIEW_STALE` on hash mismatch.
- `/api/v1` stays compatible: request shapes unchanged; response gains fields only; OpenAPI text updated.
- UI text in Russian; code identifiers in English. Follow `docs/superpowers/specs/2026-09-17-calm-fintech-visual-guidelines.md`.
- Do not create worktrees. Do not commit without explicit owner approval (commit steps below run only after the owner says so; subagents stage only). Local Playwright is not run — E2E runs in CI.
- Do not touch `identity/logo_description.png`, the landing (`IncomePreview.vue`, `landing.ts`).
- Integration tests need local Postgres (`pnpm infra:up`, already running for the owner); never run `pnpm infra:down`.

## File Map

| File | Change |
|---|---|
| `apps/api/src/funding/rule-engine.ts` | export `compareFundingRules` (queue order) and use it inside `suggestFunding` |
| `apps/api/src/funding/rule-engine.test.ts` | test for `compareFundingRules` |
| `apps/api/src/funding/funding-preview.repository.ts` | `PreviewEnvelope.name`, select `name` |
| `apps/api/src/funding/funding-preview.application.service.ts` | line slots, zero lines, override fallback, new body fields |
| `apps/api/src/funding/funding.dto.ts` | `FundingPreviewLineDto` new fields; `FundingConfirmLineDto.amount` description |
| `apps/api/src/funding/funding.controller.ts` | preview/confirm descriptions |
| `apps/api/src/funding/funding-confirm.application.service.ts` | accept zero lines, write only positive |
| `apps/api/test/v2-funding-preview.integration.test.ts` | adapt exact-lines asserts; new tests |
| `apps/api/test/v2-funding-confirm.integration.test.ts` | zero-line tests |
| `apps/web/app/composables/useEnvelopePlanV2.ts` | response line type fields |
| `apps/web/app/components/funding/FundingEntryHost.vue` | drop zero rejection, pass new fields |
| `apps/web/app/components/funding/FundingEntryHost.test.ts` | zero line, all lines confirmed |
| `apps/web/app/components/funding/FundingReviewSheet.vue` | all-envelopes UI, debounce, copy, confirm gating |
| `apps/web/app/components/funding/FundingReviewSheet.test.ts` | new behavior tests, updated copy |
| `e2e/envelope-v2-payments.spec.ts` | assert a zero row for an envelope without a suggestion |

---

### Task 1: Preview returns a line for every active envelope

**Files:**
- Modify: `apps/api/src/funding/rule-engine.ts`
- Modify: `apps/api/src/funding/rule-engine.test.ts`
- Modify: `apps/api/src/funding/funding-preview.repository.ts:16-21,84-90`
- Modify: `apps/api/src/funding/funding-preview.application.service.ts`
- Modify: `apps/api/src/funding/funding.dto.ts:77-97`
- Modify: `apps/api/src/funding/funding.controller.ts:94-101` (preview description)
- Test: `apps/api/test/v2-funding-preview.integration.test.ts`

**Interfaces:**
- Produces (rule-engine): `export function compareFundingRules(a: FundingRuleInput, b: FundingRuleInput): number`
- Produces (HTTP): preview `lines[]` item = `{ envelopeId: string; periodId: string | null; lineId: string | null; suggestedMinor: string; queuePosition: number | null; periodStartsOn: string | null; periodEndsOn: string | null }` (dates `YYYY-MM-DD`). Zero lines are included.

- [ ] **Step 1: Unit test for the exported comparator**

Append to `apps/api/src/funding/rule-engine.test.ts` (keep existing imports; add `compareFundingRules` to the import from `./rule-engine.js`):

```ts
describe('compareFundingRules', () => {
  it('orders by slotAfterPeriod, priority, envelopeId, periodId', () => {
    const rule = (
      envelopeId: string,
      priority: number,
      extra: Partial<FundingRuleInput> = {},
    ): FundingRuleInput => ({
      envelopeId,
      periodId: null,
      priority,
      kind: 'SUGGESTED_FIXED',
      needMinor: 0n,
      ...extra,
    });
    const sorted = [
      rule('b', 1, { slotAfterPeriod: true }),
      rule('c', 2),
      rule('a', 2),
      rule('z', 1),
    ].sort(compareFundingRules);
    expect(sorted.map((item) => item.envelopeId)).toEqual(['z', 'a', 'c', 'b']);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`compareFundingRules` not exported)

Run: `pnpm --filter @harmofin/api exec vitest run --config vitest.config.ts src/funding/rule-engine.test.ts`
Expected: FAIL — `compareFundingRules is not a function` / import error.

- [ ] **Step 3: Export the comparator and use it in `suggestFunding`**

In `apps/api/src/funding/rule-engine.ts`, add above `suggestFunding`:

```ts
/** Queue order of rule lines: `slotAfterPeriod` last, then priority, envelopeId, periodId. */
export function compareFundingRules(a: FundingRuleInput, b: FundingRuleInput): number {
  return (
    Number(Boolean(a.slotAfterPeriod)) - Number(Boolean(b.slotAfterPeriod)) ||
    a.priority - b.priority ||
    compareText(a.envelopeId, b.envelopeId) ||
    compareText(a.periodId ?? '', b.periodId ?? '')
  );
}
```

and replace the inline sort in `suggestFunding` with:

```ts
  const ordered = [...input.orderedRules].sort(compareFundingRules);
```

- [ ] **Step 4: Run rule-engine tests, expect PASS**

Run: same command as Step 2. Expected: all PASS.

- [ ] **Step 5: Write failing integration tests for the full line list**

In `apps/api/test/v2-funding-preview.integration.test.ts`:

1. Extend `PreviewBody['lines']` item type with `queuePosition: number | null; periodStartsOn: string | null; periodEndsOn: string | null;`.
2. Add a helper below `const otherSlot = …`:

```ts
/** Lines the server actually proposes money for; zero lines are listed but carry nothing. */
const positiveLines = (lines: PreviewBody['lines']) =>
  lines
    .filter((line) => line.suggestedMinor !== '0')
    .map(({ envelopeId, periodId, lineId, suggestedMinor }) => ({
      envelopeId,
      periodId,
      lineId,
      suggestedMinor,
    }));
```

3. In every existing assertion that compares a whole `lines` array or tests `.some(...)` on it (currently lines 192, 204, 225, 234, 288, 295, 327, 340, 364, 378, 393, 412, 490, 508, 538, 572), wrap the array: `expect(positiveLines(body.lines)).toEqual([...])`, `positiveLines(other.lines).some(...)`, `expect(positiveLines(afterExpense.lines)).toEqual(positiveLines(second.lines))`, `positiveLines(body.lines).reduce(...)`. Expected arrays stay unchanged.
4. Add new tests before the OpenAPI test:

```ts
  it('все активные конверты: правила по очереди, затем без правила по имени, нули включены', async () => {
    const response = await preview({ sourceKind: 'INCOME', incomeTransactionId: income1 });
    expect(response.statusCode).toBe(200);
    const body = response.json<PreviewBody>();
    const ids = body.lines.map((line) => line.lineId ?? line.envelopeId);
    // Queue: mandatory current (1), current-period envelope (10), savings (30), mandatory next (slot after).
    expect(ids.slice(0, 4)).toEqual([
      `${mandatoryEnvelope}||MANDATORY_CURRENT`,
      currentEnvelope,
      savingsEnvelope,
      `${mandatoryEnvelope}||MANDATORY_NEXT`,
    ]);
    expect(body.lines.slice(0, 4).map((line) => line.queuePosition)).toEqual([1, 2, 3, 4]);
    // Without a queued rule, by name: «Другой» (other half, rule skipped), «Ремонт».
    expect(body.lines.slice(4).map((line) => line.envelopeId)).toEqual([
      otherSlotEnvelope,
      repairEnvelope,
    ]);
    expect(body.lines.slice(4).every((line) => line.queuePosition === null)).toBe(true);
    expect(body.lines.find((line) => line.envelopeId === repairEnvelope)).toMatchObject({
      suggestedMinor: '0',
      periodId: null,
      periodStartsOn: null,
      periodEndsOn: null,
    });
  });

  it('конверт другой половины получает ближайший период этого слота', async () => {
    const body = (await preview({ sourceKind: 'FREE' })).json<PreviewBody>();
    const other = body.lines.find((line) => line.envelopeId === otherSlotEnvelope)!;
    const nextStart = addIsoDays(current.end, 1);
    expect(other.periodStartsOn).toBe(nextStart);
    const row = await prisma.envelopePeriod.findUniqueOrThrow({ where: { id: other.periodId! } });
    expect(row.envelopeId).toBe(otherSlotEnvelope);
    expect(row.startsOn.toISOString().slice(0, 10)).toBe(nextStart);
    const currentLine = body.lines.find((line) => line.envelopeId === currentEnvelope)!;
    expect(currentLine.periodStartsOn).toBe(current.start);
    expect(currentLine.periodEndsOn).toBe(current.end);
  });

  it('override в нулевую строку и обнуление предложения; освобождённое остаётся в остатке', async () => {
    const keyOf = (line: PreviewBody['lines'][number]) =>
      line.lineId ?? `${line.envelopeId}|${line.periodId ?? ''}`;
    const base = (await preview({ sourceKind: 'FREE' })).json<PreviewBody>();
    const zeroed = base.lines.find((line) => line.suggestedMinor !== '0')!;
    const overrides = [
      {
        envelopeId: zeroed.envelopeId,
        ...(zeroed.periodId ? { periodId: zeroed.periodId } : {}),
        ...(zeroed.lineId ? { lineId: zeroed.lineId } : {}),
        amount: '0',
      },
      { envelopeId: repairEnvelope, amount: '100.50' },
    ];
    const body = (await preview({ sourceKind: 'FREE', overrides })).json<PreviewBody>();
    expect(body.lines.map(keyOf)).toEqual(base.lines.map(keyOf));
    const amountOf = (lines: PreviewBody['lines'], key: string) =>
      lines.find((line) => keyOf(line) === key)!.suggestedMinor;
    expect(amountOf(body.lines, keyOf(zeroed))).toBe('0');
    expect(amountOf(body.lines, `${repairEnvelope}|`)).toBe('10050');
    // Freed money does not flow to the next rule: every other line keeps its base amount.
    for (const line of body.lines) {
      const key = keyOf(line);
      if (key === keyOf(zeroed) || key === `${repairEnvelope}|`) continue;
      expect(line.suggestedMinor).toBe(amountOf(base.lines, key));
    }
    expect(BigInt(body.remainingMinor)).toBe(
      BigInt(base.remainingMinor) + BigInt(zeroed.suggestedMinor) - 10_050n,
    );
  });

  it('override по MANDATORY_NEXT, когда очередь до него не дошла, остаётся строкой следующего периода', async () => {
    const created = await createMandatoryOccurrence(2_000_000n, day(addIsoDays(current.end, 1)));
    try {
      const nextId = `${mandatoryEnvelope}||MANDATORY_NEXT`;
      const body = (
        await preview({
          sourceKind: 'INCOME',
          incomeTransactionId: income3,
          overrides: [{ envelopeId: mandatoryEnvelope, lineId: nextId, amount: '10' }],
        })
      ).json<PreviewBody>();
      const mandatoryLines = body.lines.filter((line) => line.envelopeId === mandatoryEnvelope);
      expect(mandatoryLines.map((line) => line.lineId)).toEqual([
        `${mandatoryEnvelope}||MANDATORY_CURRENT`,
        nextId,
      ]);
      expect(mandatoryLines[1]!.suggestedMinor).toBe('1000');
    } finally {
      await prisma.planOccurrence.deleteMany({ where: { id: created.occurrenceId } });
      await prisma.regularPlan.deleteMany({ where: { id: created.planId } });
    }
  });

  it('архивный конверт в строках отсутствует', async () => {
    const archived = await createEnvelope(owner().budgetId, 'SAVINGS_GOAL', 'Архивный');
    await prisma.envelope.update({ where: { id: archived }, data: { archivedAt: new Date() } });
    const body = (await preview({ sourceKind: 'FREE' })).json<PreviewBody>();
    expect(body.lines.some((line) => line.envelopeId === archived)).toBe(false);
  });
```

Note: `income3` («Шабашка») is covered by the Шабашка→Ремонт category suggestion enabled in an earlier test, so the engine proposes only the Ремонт line and the `MANDATORY_NEXT` slot has no suggestion — exactly the case being tested. Slots come from `orderedRules`, which are built regardless of the category override.

- [ ] **Step 6: Run, expect FAIL**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-funding-preview.integration.test.ts`
Expected: the new tests FAIL (no zero lines, no `queuePosition`); adapted old tests PASS.

- [ ] **Step 7: Repository — envelope name**

`apps/api/src/funding/funding-preview.repository.ts`:

```ts
export type PreviewEnvelope = {
  id: string;
  name: string;
  envelopeType: EnvelopeType;
  periodSlot: 'FIRST' | 'SECOND' | null;
  archivedAt: Date | null;
};
```

and in `listEnvelopes` select `{ id: true, name: true, envelopeType: true, periodSlot: true, archivedAt: true }`. The name is display order only; it is **not** added to `FundingPreviewState` (the hash).

- [ ] **Step 8: Service — types**

In `funding-preview.application.service.ts`:

```ts
// FundingPreviewBody.lines item gains:
    /** 1-based position in the rule queue; null for envelopes without a queued rule. */
    queuePosition: number | null;
    /** Period of the line (YYYY-MM-DD); null for envelopes without periods. */
    periodStartsOn: string | null;
    periodEndsOn: string | null;
```

```ts
type Line = {
  envelopeId: string;
  periodId: string | null;
  amountMinor: bigint;
  lineId?: string;
  queuePosition?: number | null;
  periodStartsOn?: string | null;
  periodEndsOn?: string | null;
};

type PeriodRange = { id: string; start: string; end: string };
```

Import `compareFundingRules` from `./rule-engine.js`.

- [ ] **Step 9: Service — slot builder**

Add a private method to `FundingPreviewApplicationService`:

```ts
  /**
   * One zero line per active envelope, built before overrides so every override (by lineId or
   * envelope/period) finds its row: the rule queue in suggestFunding order, then envelopes
   * without a queued rule by name. A period envelope outside the queue gets the current period of
   * its slot or, for the other half, the next one (idempotent structural row, like the category
   * target). The mandatory envelope outside the queue keeps its canonical current-slice id.
   */
  private async lineSlots(
    tx: Prisma.TransactionClient,
    budgetId: string,
    envelopes: PreviewEnvelope[],
    orderedRules: FundingRuleInput[],
    periodRows: Map<string, EnvelopePeriodRecord>,
    ranges: { current: PeriodRange; next: PeriodRange },
    actor: PeriodActor,
  ): Promise<Line[]> {
    const periodById = new Map([...periodRows.values()].map((row) => [row.id, row]));
    const datesOf = (row: EnvelopePeriodRecord | undefined) => ({
      periodStartsOn: row ? isoDate(row.startsOn) : null,
      periodEndsOn: row ? isoDate(row.endsOn) : null,
    });
    const slots: Line[] = [];
    const queued = new Set<string>();
    [...orderedRules].sort(compareFundingRules).forEach((rule, index) => {
      queued.add(rule.envelopeId);
      slots.push({
        envelopeId: rule.envelopeId,
        periodId: rule.periodId,
        amountMinor: 0n,
        ...(rule.lineId !== undefined ? { lineId: rule.lineId } : {}),
        queuePosition: index + 1,
        ...datesOf(rule.periodId === null ? undefined : periodById.get(rule.periodId)),
      });
    });
    const rest = envelopes
      .filter((envelope) => !envelope.archivedAt && !queued.has(envelope.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const envelope of rest) {
      let period: EnvelopePeriodRecord | undefined;
      if (envelope.periodSlot) {
        const isCurrent = envelope.periodSlot === ranges.current.id;
        const range = isCurrent ? ranges.current : ranges.next;
        period =
          (isCurrent ? periodRows.get(envelope.id) : undefined) ??
          (await this.rules.getOrCreatePeriod(
            tx,
            budgetId,
            envelope.id,
            range.start,
            range.end,
            actor,
          ));
      }
      slots.push({
        envelopeId: envelope.id,
        periodId: period?.id ?? null,
        amountMinor: 0n,
        ...(envelope.envelopeType === 'MANDATORY_EXPENSES' && !envelope.periodSlot
          ? { lineId: mandatoryLineId(envelope.id, 'MANDATORY_CURRENT') }
          : {}),
        queuePosition: null,
        ...datesOf(period),
      });
    }
    return slots;
  }
```

Import `type PeriodActor` from `../envelope-plans/funding-rule.repository.js` (exported there, line 29); the `actor` object already built in `compute` satisfies it.

- [ ] **Step 10: Service — seed lines from slots, then overrides**

Replace

```ts
    const lines: Line[] = suggested.map((line) => ({ ...line }));
```

with

```ts
    // Every active envelope has a line; rule suggestions fill their own slot.
    const lines = await this.lineSlots(
      tx,
      budgetId,
      envelopes,
      orderedRules,
      periodRows,
      { current: currentPeriod, next: nextPeriod },
      actor,
    );
    for (const suggestion of suggested) {
      const key = lineKey(suggestion.envelopeId, suggestion.periodId);
      const slot = lines.find((line) => lineMatchesOverride(line, suggestion.lineId, key));
      if (slot) slot.amountMinor = suggestion.amountMinor;
      else lines.push({ ...suggestion, queuePosition: null, periodStartsOn: null, periodEndsOn: null });
    }
```

(The `else` branch covers a category-suggestion target whose period differs from its slot; it keeps the old behavior of showing that line.)

In the override loop, replace

```ts
      const existing = lines.find((line) => lineMatchesOverride(line, override.lineId, key));
```

with

```ts
      // An unknown lineId falls back to the envelope/period row instead of duplicating it.
      const existing =
        lines.find((line) => lineMatchesOverride(line, override.lineId, key)) ??
        (override.lineId !== undefined
          ? lines.find((line) => lineMatchesOverride(line, undefined, key))
          : undefined);
```

and in the `lines.push({...})` of the not-found branch add `queuePosition: null, periodStartsOn: null, periodEndsOn: null`.

Replace

```ts
    const finalLines = lines.filter((line) => line.amountMinor > 0n);
    const total = finalLines.reduce((sum, line) => sum + line.amountMinor, 0n);
```

with

```ts
    const total = lines.reduce((sum, line) => sum + line.amountMinor, 0n);
```

and in the body build `lines: lines.map((line) => ({ envelopeId: line.envelopeId, periodId: line.periodId, lineId: line.lineId ?? null, suggestedMinor: formatMinorUnits(line.amountMinor), queuePosition: line.queuePosition ?? null, periodStartsOn: line.periodStartsOn ?? null, periodEndsOn: line.periodEndsOn ?? null }))`.

Do not change `state` (hash inputs): overrides already carry every user value, including zeros.

- [ ] **Step 11: DTO + OpenAPI text**

`apps/api/src/funding/funding.dto.ts`, in `FundingPreviewLineDto` after `suggestedMinor`:

```ts
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1,
    description: 'Номер строки в очереди правил пополнения (с 1); null — у конверта нет правила в очереди.',
  })
  queuePosition!: number | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, description: 'Начало периода строки; null для конверта без периодов.' })
  periodStartsOn!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true, description: 'Конец периода строки; null для конверта без периодов.' })
  periodEndsOn!: string | null;
```

and change the `suggestedMinor` property to `@ApiProperty({ type: String, example: '4000000', description: 'Предложенная или введённая сумма в копейках; "0" — конверт в списке без суммы.' })`.

`funding.controller.ts` preview `description`: append `' lines содержит строку для каждого неархивного конверта: сначала очередь правил (queuePosition), затем конверты без правила по имени; конверт без предложения — suggestedMinor "0". Конверт другой половины получает ближайший период своего слота (идемпотентная структурная строка).'`

- [ ] **Step 12: Run preview + OpenAPI tests, expect PASS**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-funding-preview.integration.test.ts test/v2-openapi.integration.test.ts`
Expected: PASS. If `v2-openapi` snapshots the line schema, update its expectation to include the three new properties.

- [ ] **Step 13: Typecheck + unit**

Run: `pnpm --filter @harmofin/api typecheck` and `pnpm --filter @harmofin/api test`
Expected: PASS.

- [ ] **Step 14: Stage (commit only after owner approval)**

```bash
git add apps/api/src/funding/rule-engine.ts apps/api/src/funding/rule-engine.test.ts apps/api/src/funding/funding-preview.repository.ts apps/api/src/funding/funding-preview.application.service.ts apps/api/src/funding/funding.dto.ts apps/api/src/funding/funding.controller.ts apps/api/test/v2-funding-preview.integration.test.ts
git commit -m "feat(api): preview распределения со всеми конвертами"
```

Reviews for this task: financial, security/isolation, API.

---

### Task 2: Confirm accepts zero lines

**Files:**
- Modify: `apps/api/src/funding/funding-confirm.application.service.ts:104-131`
- Modify: `apps/api/src/funding/funding.dto.ts:157-184` (`FundingConfirmLineDto.amount`)
- Modify: `apps/api/src/funding/funding.controller.ts:118-140` (confirm description, 400 description)
- Test: `apps/api/test/v2-funding-confirm.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 preview (`lines` with zeros; overrides with `amount: '0'` are part of the hash).
- Produces: confirm `lines[].amount` accepts `'0'`; writes assignments only for positive lines; `assignments` in the response lists only written lines.

- [ ] **Step 1: Failing tests**

In `v2-funding-confirm.integration.test.ts`:

1. In `'чужой конверт/период/цель 404, архивный 422, дубль 400, ноль 400'` rename to `'… дубль 400, отрицательная 400'` and replace the zero assertion with:

```ts
    expect(
      (await confirm({ ...base, lines: [{ envelopeId: repairEnvelope, amount: '-1.00' }] }))
        .statusCode,
    ).toBe(400);
    const zeroOnly = await confirm({ ...base, lines: [{ envelopeId: repairEnvelope, amount: '0' }] });
    expect(zeroOnly.statusCode).toBe(200);
    expect(zeroOnly.json()).toMatchObject({ assignedMinor: '0', assignments: [] });
```

2. Add a test (reuse the file's `preview`, `confirm`, `snapshot`, `createIncome` helpers and its `Line` type):

```ts
  it('нулевые строки участвуют в хеше, но не создают назначений', async () => {
    const income = await createIncome(owner().budgetId, accountId, salaryCategory, 1_000_000n);
    const lines: Line[] = [
      { envelopeId: repairEnvelope, amount: '0' },
      { envelopeId: savingsEnvelope, amount: '300.00' },
    ];
    const previewed = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      overrides: lines,
      confirmPeriodTargets: [],
    });
    const response = await confirm({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      previewHash: previewed.previewHash,
      confirmPeriodTargets: [],
      lines,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ assignedMinor: string; assignments: Array<{ envelopeId: string }> }>();
    expect(body.assignedMinor).toBe('30000');
    expect(body.assignments.map((item) => item.envelopeId)).toEqual([savingsEnvelope]);
    expect(
      await prisma.envelopeAssignment.count({
        where: { budgetId: owner().budgetId, envelopeId: repairEnvelope, sourceIncomeTransactionId: income },
      }),
    ).toBe(0);

    // Dropping the zero line from confirm changes the overrides -> stale.
    const again = await preview({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      overrides: lines,
      confirmPeriodTargets: [],
    });
    const stale = await confirm({
      sourceKind: 'INCOME',
      incomeTransactionId: income,
      previewHash: again.previewHash,
      confirmPeriodTargets: [],
      lines: [lines[1]!],
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ code: string }>().code).toBe('PREVIEW_STALE');
  });
```

Adjust helper names to the file's actual ones (`preview` there returns the parsed body with `previewHash`; check its signature at the top of the file and the `snapshot`/`confirm` helpers).

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-funding-confirm.integration.test.ts`
Expected: FAIL — zero line returns 400.

- [ ] **Step 3: Implement**

In `funding-confirm.application.service.ts` replace the `parsed` block:

```ts
    // A zero line is the user's explicit "nothing here": it stays in the hash recompute (it is an
    // override of the preview) but never becomes an assignment.
    const requested: ParsedLine[] = input.lines.map((line) => ({
      envelopeId: line.envelopeId,
      periodId: line.periodId ?? null,
      amountMinor: parseDecimalToMinorUnits(line.amount, RUB_SCALE, false),
      ...(line.lineId !== undefined ? { lineId: line.lineId } : {}),
    }));
    const parsed = requested.filter((line) => line.amountMinor > 0n);
```

Keep the early no-op `if (parsed.length === 0 && targetIds.length === 0)` as is (now also covers zero-only lines). In `requestHash` use `requested` instead of `parsed` so the idempotency fingerprint covers every line. The `compute(... overrides: input.lines ...)` call and the simulation/write loops stay on `parsed` (positive only) — unchanged code.

Verify `parseDecimalToMinorUnits(…, false)` rejects negatives with a 400 (`VALIDATION_FAILED`); if it throws a non-HTTP error, wrap: `catch → throw validationFailed('Сумма распределения не может быть отрицательной.', 'lines')`.

- [ ] **Step 4: DTO/OpenAPI text**

`FundingConfirmLineDto.amount` description: `'Сумма в рублях ≥ 0: десятичная строка, до 2 знаков. Строка с 0 участвует в проверке previewHash, но назначения не создаёт.'`
Controller confirm description: replace `сумма 0 в preview убирает строку, а confirm отвечает на 0 кодом 400` with `строки с суммой 0 передаются так же, как в overrides preview, и не создают назначений; только нулевые строки без целей — 200 без записи`. 400 response description: `'VALIDATION_FAILED: некорректное тело, ключ, отрицательная или повторная строка.'`

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm --filter @harmofin/api test:integration -- test/v2-funding-confirm.integration.test.ts test/v2-openapi.integration.test.ts` then `pnpm --filter @harmofin/api typecheck`
Expected: PASS.

- [ ] **Step 6: Stage (commit only after owner approval)**

```bash
git add apps/api/src/funding/funding-confirm.application.service.ts apps/api/src/funding/funding.dto.ts apps/api/src/funding/funding.controller.ts apps/api/test/v2-funding-confirm.integration.test.ts
git commit -m "feat(api): confirm распределения принимает нулевые строки"
```

Reviews: financial, security/isolation, API.

---

### Task 3: Web host passes every line, zero allowed

**Files:**
- Modify: `apps/web/app/composables/useEnvelopePlanV2.ts:44-49`
- Modify: `apps/web/app/components/funding/FundingEntryHost.vue:36,267-292,353-360`
- Test: `apps/web/app/components/funding/FundingEntryHost.test.ts`

**Interfaces:**
- Consumes: preview line fields from Task 1; confirm zero lines from Task 2.
- Produces: `FundingPreviewResponse['lines'][number]` gains `queuePosition?: number | null; periodStartsOn?: string | null; periodEndsOn?: string | null` (optional in the client type so existing fixtures compile). `FundingSheetLine` (Task 4) inherits them.

- [ ] **Step 1: Failing test**

Add to `FundingEntryHost.test.ts`:

```ts
  it('zero in a line re-previews with amount 0 and confirm sends every line, zeros included', async () => {
    const OTHER = '0190a000-0000-7000-8000-0000000000e2';
    mocks.v2.previewFunding.mockResolvedValue(
      previewBody({
        lines: [
          { envelopeId: ENV, periodId: null, suggestedMinor: '400050', queuePosition: 1 },
          { envelopeId: OTHER, periodId: null, suggestedMinor: '0', queuePosition: null },
        ],
      }),
    );
    mountHost();
    useFundingEntry().offer({ sourceKind: 'INCOME', incomeTransactionId: INCOME });
    await flushPromises();

    const input = document.querySelector<HTMLInputElement>(`[data-testid="funding-amount-${ENV}"]`);
    input!.value = '';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    expect(document.body.textContent).not.toContain('Введите сумму больше нуля');
    expect(mocks.v2.previewFunding).toHaveBeenLastCalledWith(BUDGET, {
      sourceKind: 'INCOME',
      incomeTransactionId: INCOME,
      overrides: [
        { envelopeId: ENV, amount: '0' },
        { envelopeId: OTHER, amount: '0.00' },
      ],
      confirmPeriodTargets: [PERIOD],
    });

    click('funding-confirm');
    await flushPromises();
    const call = mocks.v2.confirmFunding.mock.calls.at(-1) as [string, { lines: unknown[] }, string];
    expect(call[1].lines).toHaveLength(2);
  });
```

(The mocked preview keeps returning the same body, so after the re-preview ENV is back to `400050`; the test only checks the request and that confirm forwards all lines.)

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/funding/FundingEntryHost.test.ts`
Expected: FAIL — zero rejected with «Введите сумму больше нуля…», no preview call. (The empty-field → `'0'` mapping lands in Task 4's sheet; until then an empty field shows «Введите сумму» — if so, this step's failure message is that one. Both are fixed by the end of Task 4; run this test again there.)

- [ ] **Step 3: Implement**

`useEnvelopePlanV2.ts` lines item:

```ts
  lines: Array<{
    envelopeId: string;
    /** Identifies a preview row for the next call; mandatory rows carry slice suffix. */
    lineId?: string | null;
    periodId: string | null;
    suggestedMinor: string;
    /** 1-based rule-queue position; null for envelopes without a queued rule. */
    queuePosition?: number | null;
    /** Period of the line (YYYY-MM-DD); null for envelopes without periods. */
    periodStartsOn?: string | null;
    periodEndsOn?: string | null;
  }>;
```

`FundingEntryHost.vue`:
- Delete `const ZERO_AMOUNT = …` and the whole `if (ZERO_AMOUNT.test(payload.amount)) { … return; }` block with its comment in `changeLine`.
- Replace the `VALIDATION_FAILED` text with `'Проверьте суммы: они не могут быть отрицательными.'`.
- Update the header comment paragraph: `// Every active envelope comes back as a line (zero when nothing is proposed); every preview that can end in a confirm is requested with overrides = all lines, zeros included, and confirm sends the same lines.`

`sheetLines` already spreads `...line`, so the new fields reach the sheet.

- [ ] **Step 4: Run host tests** (full pass expected after Task 4 if the empty-field case depends on the sheet)

Run: same as Step 2.

- [ ] **Step 5: Stage together with Task 4** (one web commit after owner approval).

---

### Task 4: Sheet shows all envelopes with live remainder

**Files:**
- Modify: `apps/web/app/components/funding/FundingReviewSheet.vue`
- Test: `apps/web/app/components/funding/FundingReviewSheet.test.ts`

**Interfaces:**
- Consumes: `FundingSheetLine` now carries optional `queuePosition`, `periodStartsOn`, `periodEndsOn` (via `FundingPreviewResponse['lines'][number]`).
- Produces: emits `changeLine` with `amount: '0'` for an empty field; emits after a 400 ms pause in typing (valid text only) and immediately on change/Enter.

- [ ] **Step 1: Failing tests**

Add to `FundingReviewSheet.test.ts` (use `vi` from vitest; add it to the import):

```ts
  it('empty field means zero: emits 0, no error', async () => {
    const wrapper = mountSheet();
    const input = wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`);
    await input.setValue('');
    await input.trigger('change');
    expect(wrapper.emitted('changeLine')?.[0]).toEqual([{ envelopeId: ENV_A, amount: '0' }]);
    expect(wrapper.find(`[data-testid="funding-line-error-${ENV_A}"]`).exists()).toBe(false);
  });

  it('a zero line renders an empty field with placeholder 0', () => {
    const wrapper = mountSheet({
      previewLines: [{ envelopeId: ENV_A, periodId: null, suggestedMinor: '0', name: 'Копилка' }],
    });
    const input = wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`);
    expect((input.element as HTMLInputElement).value).toBe('');
    expect(input.attributes('placeholder')).toBe('0');
  });

  it('re-previews after a typing pause, once', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountSheet();
      const input = wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`);
      await input.setValue('12');
      await input.setValue('120');
      vi.advanceTimersByTime(399);
      expect(wrapper.emitted('changeLine')).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(wrapper.emitted('changeLine')).toEqual([[{ envelopeId: ENV_A, amount: '120' }]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the focused field while a new preview arrives', async () => {
    const wrapper = mountSheet();
    const input = wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`);
    await input.trigger('focusin');
    await input.setValue('123');
    await wrapper.setProps({
      previewLines: [
        { envelopeId: ENV_A, periodId: null, suggestedMinor: '9900', name: 'Обязательные' },
        { envelopeId: ENV_B, periodId: PERIOD, suggestedMinor: '500', name: 'Отпуск' },
      ],
    });
    expect((input.element as HTMLInputElement).value).toBe('123');
    expect((wrapper.get(`[data-testid="funding-amount-${ENV_B}"]`).element as HTMLInputElement).value).toBe('5');
  });

  it('fields stay editable while a preview is pending; confirm does not', () => {
    const wrapper = mountSheet({ pending: true });
    expect(wrapper.get(`[data-testid="funding-amount-${ENV_A}"]`).attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[data-testid="funding-confirm"]').attributes('disabled')).toBeDefined();
  });

  it('numbers only queued lines and shows period dates', () => {
    const wrapper = mountSheet({
      previewLines: [
        { envelopeId: ENV_A, periodId: null, suggestedMinor: '100', name: 'Обязательные', queuePosition: 1 },
        {
          envelopeId: ENV_B,
          periodId: PERIOD,
          suggestedMinor: '0',
          name: 'Второй период',
          queuePosition: null,
          periodStartsOn: '2026-10-25',
          periodEndsOn: '2026-11-09',
        },
      ],
    });
    const [first, second] = wrapper.findAll('[data-testid="funding-line"]');
    expect(first?.get('.funding-sheet__line-number').text()).toBe('1');
    expect(second?.find('.funding-sheet__line-number').text()).toBe('');
    expect(norm(second!.text())).toContain('25 окт. – 9 нояб.');
  });

  it('confirm is off when every line is zero and no period target is selected', () => {
    const wrapper = mountSheet({
      periodTargetDrafts: [],
      previewLines: [{ envelopeId: ENV_A, periodId: null, suggestedMinor: '0', name: 'Копилка' }],
      remainingMinor: '8000000',
    });
    expect(wrapper.get('[data-testid="funding-confirm"]').attributes('disabled')).toBeDefined();
  });

  it('labels the primary action «Распределить» and explains editing any envelope', () => {
    const wrapper = mountSheet();
    expect(wrapper.get('[data-testid="funding-confirm"]').text()).toBe('Распределить');
    expect(norm(wrapper.get('[data-testid="funding-intro"]').text())).toContain(
      'Измените любую или впишите сумму в другой конверт',
    );
  });
```

Update existing tests whose expectations change:
- `'строка очереди: …'`: headers `'Конверт'` / `'Сумма'` instead of `'Очередь'` / `'Предложенная сумма'`; give the first line `queuePosition: 1` in its fixture so `'1'` is still expected.
- `'explains that the proposal is ready …'`: update expected intro text to the new copy.
- `'says everything is proposed when nothing remains to assign'`: expect `'Всё распределено: ничего не остаётся.'`.
- `'disables confirm while pending'` stays.
- Any test asserting `'Распределить как предложено'` → `'Распределить'`.

Check the date format: the sheet formats `periodStartsOn`–`periodEndsOn` with the same `Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })` used by `EnvelopeMovePanel.vue` (`dayText`); adjust the expected string to that formatter's exact output (e.g. `25 окт.`) when running the test.

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/funding/FundingReviewSheet.test.ts`
Expected: new tests FAIL.

- [ ] **Step 3: Implement — script**

In `FundingReviewSheet.vue` `<script setup>`:

```ts
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
```

Field text: a zero amount shows an empty field.

```ts
function toFieldText(minor: string): string {
  if (/^0+$/.test(minor)) return '';
  const [whole = '', fraction = ''] = toDecimalText(minor).split('.');
  if (whole === '') return '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fraction === '' || /^0+$/.test(fraction) ? grouped : `${grouped},${fraction}`;
}
```

Focus tracking and preview sync — the focused field is not overwritten:

```ts
// The field being typed in keeps the user's text when a recomputed preview arrives.
const focusedLineKey = ref<string | null>(null);

watch(
  () => props.previewLines,
  (lines) => {
    for (const line of lines) {
      const key = lineKey(line);
      if (key === focusedLineKey.value && drafts[key] !== undefined) continue;
      drafts[key] = toFieldText(line.suggestedMinor);
      delete localErrors[key];
    }
  },
  { immediate: true, deep: true },
);
```

Commit with empty → `'0'`, plus debounce:

```ts
const TYPING_PAUSE_MS = 400;
let typingTimer: ReturnType<typeof setTimeout> | null = null;

function cancelTyping(): void {
  if (typingTimer !== null) clearTimeout(typingTimer);
  typingTimer = null;
}

// Empty means "nothing here" and is sent as 0; anything else must be a decimal.
function parseDraft(key: string, text: string): string | null {
  if (text === '') {
    delete localErrors[key];
    return '0';
  }
  if (!AMOUNT_PATTERN.test(text)) {
    localErrors[key] = 'Введите сумму числом, не более двух знаков после запятой';
    return null;
  }
  delete localErrors[key];
  return text.replace(',', '.');
}

function commitDraft(line: FundingSheetLine, event?: Event): void {
  cancelTyping();
  const key = lineKey(line);
  // The field value in the DOM wins: a commit without a preceding 'input'
  // event (Enter, programmatic write) must not resend the stale draft.
  const field = (event?.target ?? null) as HTMLInputElement | null;
  const text = (field?.value ?? drafts[key] ?? '').replace(/\s/g, '');
  const amount = parseDraft(key, text);
  if (amount === null) return;
  drafts[key] = text;
  emitLine(line, amount);
}

function onTyping(line: FundingSheetLine): void {
  cancelTyping();
  const key = lineKey(line);
  const text = (drafts[key] ?? '').replace(/\s/g, '');
  // Mid-typing text is not judged yet: only a valid amount schedules a recompute.
  if (text !== '' && !AMOUNT_PATTERN.test(text)) return;
  typingTimer = setTimeout(() => {
    typingTimer = null;
    const amount = parseDraft(key, text);
    if (amount !== null) emitLine(line, amount);
  }, TYPING_PAUSE_MS);
}

onBeforeUnmount(cancelTyping);
```

Remove the old `localErrors[key] = text === '' ? 'Введите сумму' : …` branch (replaced by `parseDraft`).

Queue number, period caption, confirm gating:

```ts
function lineNumber(line: FundingSheetLine): string {
  return line.queuePosition == null ? '' : String(line.queuePosition);
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
function dayText(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return dayMonth.format(new Date(year, month - 1, day));
}
function periodCaption(line: FundingSheetLine): string | null {
  if (!line.periodStartsOn || !line.periodEndsOn) return null;
  return `${dayText(line.periodStartsOn)} – ${dayText(line.periodEndsOn)}`;
}

// String checks only: is any line non-zero, or is a period target kept?
const hasSomethingToConfirm = computed(
  () =>
    props.previewLines.some((line) => !/^0+$/.test(line.suggestedMinor)) ||
    props.periodTargetDrafts.some((draft) => draft.selectedForConfirmation),
);
const confirmDisabled = computed(
  () =>
    props.pending ||
    props.error !== null ||
    isExcess.value ||
    hasLineError.value ||
    !hasSomethingToConfirm.value,
);
```

Update the header comment of the file: the sheet lists every active envelope; empty = 0; it re-previews after a typing pause; still no money arithmetic.

- [ ] **Step 4: Implement — template**

- Intro paragraph (`data-testid="funding-intro"`):
  `Суммы предложены по правилам пополнения. Измените любую или впишите сумму в другой конверт. Деньги со счетов никуда не переводятся.`
- Queue header: `<span>Конверт</span><span>Сумма</span>`; `<ol … aria-label="Распределение по конвертам">`.
- Row head: number `{{ lineNumber(line) }}` (keep `aria-hidden`), icon, then a name block:

```vue
<span class="funding-sheet__line-title">
  <span class="funding-sheet__line-name">{{ lineName(line) }}</span>
  <span v-if="periodCaption(line)" class="funding-sheet__line-period">
    {{ periodCaption(line) }}
  </span>
</span>
```

- Visually hidden label: `Сумма для {{ lineName(line) }}<template v-if="periodCaption(line)">, {{ periodCaption(line) }}</template>`.
- Input: add `placeholder="0"`, remove `:disabled="pending"`, add `@input="onTyping(line)"`, `@focusin="focusedLineKey = lineKey(line)"`, `@focusout="focusedLineKey = null"`; keep `@change` and `@keydown.enter.prevent` → `commitDraft`.
- Row `v-for` key/order unchanged (server order).
- Footer: `'Всё предложено: ничего не остаётся.'` → `'Всё распределено: ничего не остаётся.'`; add a pending hint inside `.funding-sheet__total`:

```vue
<span v-if="pending" class="funding-sheet__muted" data-testid="funding-recount">Пересчитываем…</span>
```

- Confirm button text: `Распределить`.

CSS (scoped), using existing tokens:

```css
.funding-sheet__line-title {
  display: grid;
  min-width: 0;
}

.funding-sheet__line-period {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
```

Make sure the dialog body scrolls while the footer (already `#footer`) stays fixed: verify `UiModal` body has `overflow: auto`; if not, add `max-height`/`overflow-y: auto` on `.funding-sheet__lines`'s container only inside this component — do not change `UiModal`.

- [ ] **Step 5: Run sheet + host tests, expect PASS**

Run: `pnpm --filter @harmofin/web exec vitest run --config vitest.config.ts app/components/funding`
Expected: PASS (including Task 3's host test).

- [ ] **Step 6: Lint/typecheck web**

Run: `pnpm --filter @harmofin/web typecheck` and `pnpm lint`
Expected: PASS.

- [ ] **Step 7: Stage (commit only after owner approval)**

```bash
git add apps/web/app/composables/useEnvelopePlanV2.ts apps/web/app/components/funding/FundingEntryHost.vue apps/web/app/components/funding/FundingEntryHost.test.ts apps/web/app/components/funding/FundingReviewSheet.vue apps/web/app/components/funding/FundingReviewSheet.test.ts
git commit -m "feat(web): окно распределения со всеми конвертами"
```

Reviews: UI/UX (visual + a11y), QA.

---

### Task 5: E2E scenario and final verification

**Files:**
- Modify: `e2e/envelope-v2-payments.spec.ts:136-155`

- [ ] **Step 1: Extend the CI scenario**

After `await expect(offer.getByTestId('funding-source')).toHaveText(/^30\s000,00/);` add an assertion that the sheet lists more than the suggested lines — every envelope row is rendered and a row without a suggestion is empty:

```ts
  // Every active envelope is listed; an envelope without a suggestion shows an empty field.
  const rows = offer.getByTestId('funding-line');
  expect(await rows.count()).toBeGreaterThan(1);
  await expect(offer.getByTestId('funding-confirm')).toHaveText('Распределить');
```

If the scenario's budget has a known envelope without a rule (check the setup at the top of the spec), assert that row's input `toHaveValue('')` by its `funding-amount-<envelopeId>` test id. Do **not** run Playwright locally; CI runs it.

- [ ] **Step 2: Full named checks**

Run:
- `pnpm --filter @harmofin/api test`
- `pnpm --filter @harmofin/api test:integration -- test/v2-funding-preview.integration.test.ts test/v2-funding-confirm.integration.test.ts test/v2-openapi.integration.test.ts test/v2-funding-rules-batch.integration.test.ts`
- `pnpm --filter @harmofin/web test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`

Expected: all PASS. An unrelated failing check is reported, not fixed.

- [ ] **Step 3: Inspect final diff**

Run: `git diff --stat main...HEAD` and `git diff` — confirm only the files in the File Map changed and `identity/logo_description.png` is untouched.

- [ ] **Step 4: Final review**

Dispatch final review (`final-code-reviewer`) with the diff and the evidence above; financial and security `BLOCK` cannot be cleared without repair.

- [ ] **Step 5: Stage (commit only after owner approval)**

```bash
git add e2e/envelope-v2-payments.spec.ts
git commit -m "test(e2e): окно распределения показывает все конверты"
```
