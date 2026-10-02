import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import {
  formatPreviewRu,
  previewMigration,
  runPreview,
} from '../src/migrations/envelope-v2/migration-preview.js';
import { runPreflight } from '../src/migrations/envelope-v2/preflight.js';

const DISPOSABLE_DATABASE = 'harmofin_v22_test';

export function assertDisposableDatabase(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL is required and must point to the disposable database.');
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name !== DISPOSABLE_DATABASE || !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error(`Refusing to run cutover tests outside local ${DISPOSABLE_DATABASE}.`);
  }
  return url;
}

const databaseUrl = assertDisposableDatabase(process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const dayMs = 86_400_000;
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDay = (offsetDays: number) =>
  todayInTimezone(new Date(Date.now() + offsetDays * dayMs), 'UTC');

type World = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  accountA: string;
  accountB: string;
  envelopeA: string;
  envelopeB: string;
  incomeCategoryId: string;
  expenseCategoryId: string;
};

const worlds: World[] = [];

afterEach(async () => {
  for (const w of worlds.splice(0)) await cleanup(w);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('guard disposable БД', () => {
  it('отвергает иное имя БД, чужой хост и пустой URL', () => {
    expect(() => assertDisposableDatabase('postgresql://u:p@localhost:5432/harmofin')).toThrow();
    expect(() =>
      assertDisposableDatabase('postgresql://u:p@db.example.com/harmofin_v22_test'),
    ).toThrow();
    expect(() => assertDisposableDatabase(undefined)).toThrow();
    expect(assertDisposableDatabase('postgresql://u:p@127.0.0.1:5432/harmofin_v22_test')).toContain(
      'harmofin_v22_test',
    );
  });
});

describe('read-only preflight перед переходом на модель v2 (M01)', () => {
  it('считает физические счета со старыми confirmed transfer_parts и ACCOUNT_ONLY переводами', async () => {
    const w = await world();
    await tx(w, 'INCOME', 50_000n);
    await tx(w, 'EXPENSE', 20_000n);
    await legacyTransfer(w, 30_000n, [30_000n]);
    await accountOnlyTransfer(w, 10_000n);

    const report = await runPreflight(prisma, w.budgetId);

    expect(report.modelVersion).toBe(1);
    expect(report.cashByAccount[w.accountA]).toBe('90000');
    expect(report.cashByAccount[w.accountB]).toBe('40000');
    expect(report.totalCashMinor).toBe('130000');
    expect(report.blockers).toEqual([]);
    expect(report.archivedNonZero).toEqual([]);
    expect(report.futureConfirmed).toEqual([]);
    expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('архивный ненулевой счёт блокирует; архивный нулевой — нет', async () => {
    const w = await world();
    await legacyTransfer(w, 5_000n, [5_000n]);
    await prisma.account.update({ where: { id: w.accountB }, data: { archivedAt: new Date() } });

    const blocked = await runPreflight(prisma, w.budgetId);
    expect(blocked.blockers).toContain('ARCHIVED_ACCOUNT_HAS_CASH');
    expect(blocked.archivedNonZero).toEqual([w.accountB]);

    await accountOnlyTransferBack(w, 5_000n);
    const clear = await runPreflight(prisma, w.budgetId);
    expect(clear.archivedNonZero).toEqual([]);
    expect(clear.blockers).not.toContain('ARCHIVED_ACCOUNT_HAS_CASH');
  });

  it('подтверждённый факт в будущем блокирует, черновик в будущем — нет', async () => {
    const w = await world();
    await tx(w, 'EXPENSE', 1_000n, { occurredOn: isoDay(0), status: 'CONFIRMED' });
    await tx(w, 'EXPENSE', 1_000n, { occurredOn: isoDay(3), status: 'DRAFT' });
    expect((await runPreflight(prisma, w.budgetId)).blockers).toEqual([]);

    const future = await tx(w, 'INCOME', 2_000n, { occurredOn: isoDay(3), status: 'CONFIRMED' });
    const report = await runPreflight(prisma, w.budgetId);
    expect(report.blockers).toContain('FUTURE_CONFIRMED_FACT');
    expect(report.futureConfirmed).toEqual([future]);
  });

  it('перевод, у которого части не равны итогу, даёт INCONSISTENT_REFERENCES', async () => {
    const w = await world();
    await legacyTransfer(w, 10_000n, [4_000n, 5_000n]);
    expect((await runPreflight(prisma, w.budgetId)).blockers).toContain('INCONSISTENT_REFERENCES');
  });

  it('аллокация сверх дохода и аллокация на неподтверждённый доход дают INCONSISTENT_REFERENCES', async () => {
    const w = await world();
    const income = await tx(w, 'INCOME', 10_000n);
    await allocation(w, income, 6_000n);
    expect((await runPreflight(prisma, w.budgetId)).blockers).toEqual([]);
    await allocation(w, income, 5_000n);
    expect((await runPreflight(prisma, w.budgetId)).blockers).toEqual(['INCONSISTENT_REFERENCES']);

    const w2 = await world();
    const draft = await tx(w2, 'INCOME', 10_000n, { status: 'DRAFT' });
    await allocation(w2, draft, 1_000n);
    expect((await runPreflight(prisma, w2.budgetId)).blockers).toEqual(['INCONSISTENT_REFERENCES']);
  });

  it('создание assignment или movement между снимками меняет fingerprint', async () => {
    const w = await world();
    const base = await runPreflight(prisma, w.budgetId);
    const assignment = await prisma.envelopeAssignment.create({
      data: {
        id: randomUUID(),
        budgetId: w.budgetId,
        envelopeId: w.envelopeA,
        type: 'FREE',
        amountMinor: 1_000n,
        effectiveOn: day(isoDay(-1)),
      },
    });
    const withAssignment = await runPreflight(prisma, w.budgetId);
    expect(withAssignment.fingerprint).not.toBe(base.fingerprint);
    await prisma.envelopeAssignment.update({
      where: { id: assignment.id },
      data: { status: 'DELETED' },
    });
    const deleted = await runPreflight(prisma, w.budgetId);
    expect(deleted.fingerprint).not.toBe(withAssignment.fingerprint);
    await prisma.envelopeMovement.create({
      data: {
        id: randomUUID(),
        budgetId: w.budgetId,
        sourceEnvelopeId: w.envelopeA,
        destinationEnvelopeId: w.envelopeB,
        amountMinor: 1n,
        effectiveOn: day(isoDay(-1)),
      },
    });
    expect((await runPreflight(prisma, w.budgetId)).fingerprint).not.toBe(deleted.fingerprint);
  });

  it('READ не меняет остатки и не создаёт назначений', async () => {
    const w = await world();
    await tx(w, 'INCOME', 50_000n);
    await legacyTransfer(w, 30_000n, [30_000n]);
    const counts = () =>
      Promise.all([
        prisma.transaction.count({ where: { budgetId: w.budgetId } }),
        prisma.transfer.count({ where: { budgetId: w.budgetId } }),
        prisma.transferPart.count({ where: { budgetId: w.budgetId } }),
        prisma.envelopeMovement.count({ where: { budgetId: w.budgetId } }),
      ]);
    const countsBefore = await counts();

    const before = await runPreflight(prisma, w.budgetId);
    const after = await runPreflight(prisma, w.budgetId);

    expect(after.totalCashMinor).toBe(before.totalCashMinor);
    expect(await prisma.envelopeAssignment.count({ where: { budgetId: w.budgetId } })).toBe(0);
    expect(await counts()).toEqual(countsBefore);
    const budget = await prisma.budget.findUniqueOrThrow({ where: { id: w.budgetId } });
    expect(budget.planModelVersion).toBe(1);
  });

  it('показывает архивные и отрицательные конверты и действующие регулярные планы', async () => {
    const w = await world();
    const negative = await envelope(w, { startingBalanceMinor: -7_000n });
    const archived = await envelope(w, { startingBalanceMinor: 0n, archivedAt: new Date() });
    const expense = await plan(w, 'EXPENSE', { envelopeId: w.envelopeA });
    const income = await plan(w, 'INCOME', {});
    const savings = await plan(w, 'SAVINGS', { envelopeId: w.envelopeB });
    await plan(w, 'EXPENSE', { isActive: false });
    await plan(w, 'EXPENSE', { deletedAt: new Date(), isActive: false });

    const report = await runPreflight(prisma, w.budgetId);

    const byId = new Map(report.legacyEnvelopeSummary.map((row) => [row.envelopeId, row]));
    expect(byId.get(negative)).toEqual({
      envelopeId: negative,
      archived: false,
      legacyBalanceMinor: '-7000',
    });
    expect(byId.get(archived)?.archived).toBe(true);
    expect(report.negativeEnvelopes).toEqual([negative]);
    expect(report.archivedEnvelopes).toEqual([archived]);
    expect(report.regularPlansForReview.map((p) => p.id).sort()).toEqual(
      [expense, income, savings].sort(),
    );
    expect(report.regularPlansForReview.find((p) => p.id === savings)).toEqual({
      id: savings,
      planType: 'SAVINGS',
      envelopeId: w.envelopeB,
      isActive: true,
    });
    expect(JSON.stringify(report.regularPlansForReview)).not.toContain('amount');
    expect(await prisma.envelopeAssignment.count({ where: { budgetId: w.budgetId } })).toBe(0);
  });

  it('чужой бюджет не влияет на cash и fingerprint', async () => {
    const w = await world();
    await tx(w, 'INCOME', 50_000n);
    const before = await runPreflight(prisma, w.budgetId);

    const other = await world();
    await tx(other, 'INCOME', 999_000n);
    await tx(other, 'EXPENSE', 1n, { occurredOn: isoDay(5), status: 'CONFIRMED' });
    await prisma.account.update({
      where: { id: other.accountB },
      data: { archivedAt: new Date() },
    });
    const after = await runPreflight(prisma, w.budgetId);

    expect(after.cashByAccount).toEqual(before.cashByAccount);
    expect(after.totalCashMinor).toBe(before.totalCashMinor);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.blockers).toEqual([]);
    expect(Object.keys(after.cashByAccount)).not.toContain(other.accountA);
  });

  it('fingerprint стабилен и меняется при updatedAt, сумме и статусе', async () => {
    const w = await world();
    const id = await tx(w, 'EXPENSE', 1_000n);
    const base = await runPreflight(prisma, w.budgetId);
    expect((await runPreflight(prisma, w.budgetId)).fingerprint).toBe(base.fingerprint);

    await prisma.transaction.update({
      where: { id },
      data: { updatedAt: new Date(Date.now() + 60_000) },
    });
    const touched = await runPreflight(prisma, w.budgetId);
    expect(touched.fingerprint).not.toBe(base.fingerprint);
    expect(touched.totalCashMinor).toBe(base.totalCashMinor);

    await prisma.transaction.update({ where: { id }, data: { amountMinor: 1_001n } });
    const amount = await runPreflight(prisma, w.budgetId);
    expect(amount.fingerprint).not.toBe(touched.fingerprint);

    await prisma.transaction.update({ where: { id }, data: { status: 'DRAFT' } });
    const status = await runPreflight(prisma, w.budgetId);
    expect(status.fingerprint).not.toBe(amount.fingerprint);

    await prisma.budget.update({ where: { id: w.budgetId }, data: { cycleStartDay: 5 } });
    expect((await runPreflight(prisma, w.budgetId)).fingerprint).not.toBe(status.fingerprint);
  });

  it('бюджет не модели v1 отвергается', async () => {
    const w = await world();
    await prisma.budget.update({ where: { id: w.budgetId }, data: { planModelVersion: 2 } });
    await expect(runPreflight(prisma, w.budgetId)).rejects.toThrow(/PLAN_MODEL_NOT_V1/);
  });

  it('несуществующий бюджет отвергается', async () => {
    await expect(runPreflight(prisma, randomUUID())).rejects.toThrow(/BUDGET_NOT_FOUND/);
  });
});

const NO_CHOICES = { assignments: [], periodTargets: [], fundingRules: [] };

/** Historical shape: start 60000, income 60000 allocated in full, expense 20000 -> cash 100000. */
async function historicalWorld(): Promise<World> {
  const w = await world();
  await prisma.account.update({
    where: { id: w.accountA },
    data: { startingBalanceMinor: 6_000_000n },
  });
  const income = await tx(w, 'INCOME', 6_000_000n);
  await allocation(w, income, 6_000_000n);
  await tx(w, 'EXPENSE', 2_000_000n);
  return w;
}

async function world(): Promise<World> {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const budgetId = randomUUID();
  await prisma.user.create({
    data: { id: userId, email: `v2-cutover-${userId}@harmofin.test`, passwordHash: 'x' },
  });
  await prisma.workspace.create({
    data: { id: workspaceId, ownerId: userId, name: 'Cutover', timezone: 'UTC' },
  });
  await prisma.budget.create({
    data: {
      id: budgetId,
      workspaceId,
      name: 'Cutover',
      timezone: 'UTC',
      planModelVersion: 1,
      cycleStartDay: 1,
      periodBoundaryOffset: 14,
    },
  });
  const account = (startingBalanceMinor: bigint) =>
    prisma.account.create({
      data: {
        id: randomUUID(),
        budgetId,
        name: `Счёт ${randomUUID().slice(0, 6)}`,
        accountType: 'BANK_ACCOUNT',
        startingBalanceMinor,
        accountingStartDate: day('2020-01-01'),
      },
    });
  const category = (categoryType: 'INCOME' | 'EXPENSE') =>
    prisma.category.create({
      data: {
        id: randomUUID(),
        budgetId,
        name: `К ${randomUUID().slice(0, 6)}`,
        categoryType,
        displayOrder: 900,
      },
    });
  const a = await account(100_000n);
  const b = await account(0n);
  const w: World = {
    userId,
    workspaceId,
    budgetId,
    accountA: a.id,
    accountB: b.id,
    envelopeA: '',
    envelopeB: '',
    incomeCategoryId: (await category('INCOME')).id,
    expenseCategoryId: (await category('EXPENSE')).id,
  };
  worlds.push(w);
  w.envelopeA = await envelope(w, { startingBalanceMinor: 0n });
  w.envelopeB = await envelope(w, { startingBalanceMinor: 0n });
  return w;
}

async function envelope(
  w: World,
  data: {
    startingBalanceMinor: bigint;
    archivedAt?: Date;
    envelopeType?: 'CUSTOM' | 'MANDATORY_EXPENSES' | 'CURRENT_EXPENSES';
    periodSlot?: 'FIRST' | 'SECOND';
  },
): Promise<string> {
  const row = await prisma.envelope.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      name: `Е ${randomUUID().slice(0, 6)}`,
      envelopeType: 'CUSTOM',
      displayOrder: 950,
      ...data,
    },
  });
  return row.id;
}

async function tx(
  w: World,
  type: 'INCOME' | 'EXPENSE',
  amountMinor: bigint,
  options: { occurredOn?: string; status?: 'CONFIRMED' | 'DRAFT' } = {},
): Promise<string> {
  const row = await prisma.transaction.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      transactionType: type,
      status: options.status ?? 'CONFIRMED',
      amountMinor,
      occurredOn: day(options.occurredOn ?? isoDay(-10)),
      accountId: w.accountA,
      categoryId: type === 'INCOME' ? w.incomeCategoryId : w.expenseCategoryId,
      envelopeId: type === 'EXPENSE' ? w.envelopeA : null,
      isPlanned: false,
      confirmedAt: new Date(),
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
      accountingModelVersion: 1,
    },
  });
  return row.id;
}

async function legacyTransfer(w: World, totalMinor: bigint, parts: bigint[]): Promise<void> {
  const id = randomUUID();
  await prisma.transfer.create({
    data: {
      id,
      budgetId: w.budgetId,
      status: 'CONFIRMED',
      mode: 'LEGACY_PARTS',
      totalMinor,
      occurredOn: day(isoDay(-9)),
      confirmedAt: new Date(),
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
    },
  });
  for (const amountMinor of parts) {
    await prisma.transferPart.create({
      data: {
        id: randomUUID(),
        transferId: id,
        budgetId: w.budgetId,
        sourceAccountId: w.accountA,
        destinationAccountId: w.accountB,
        sourceEnvelopeId: w.envelopeA,
        destinationEnvelopeId: w.envelopeB,
        amountMinor,
      },
    });
  }
}

async function accountOnlyTransfer(w: World, totalMinor: bigint): Promise<void> {
  await directTransfer(w, totalMinor, w.accountA, w.accountB);
}

async function accountOnlyTransferBack(w: World, totalMinor: bigint): Promise<void> {
  await directTransfer(w, totalMinor, w.accountB, w.accountA);
}

async function directTransfer(
  w: World,
  totalMinor: bigint,
  sourceAccountId: string,
  destinationAccountId: string,
): Promise<void> {
  await prisma.transfer.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      status: 'CONFIRMED',
      mode: 'ACCOUNT_ONLY',
      totalMinor,
      occurredOn: day(isoDay(-8)),
      confirmedAt: new Date(),
      sourceAccountId,
      destinationAccountId,
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
    },
  });
}

async function allocation(w: World, incomeId: string, amountMinor: bigint): Promise<void> {
  await prisma.incomeAllocation.create({
    data: {
      id: randomUUID(),
      budgetId: w.budgetId,
      incomeTransactionId: incomeId,
      status: 'CONFIRMED',
      amountMinor,
      occurredOn: day(isoDay(-10)),
      accountId: w.accountA,
      envelopeId: w.envelopeA,
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
    },
  });
}

async function plan(
  w: World,
  planType: 'INCOME' | 'EXPENSE' | 'SAVINGS',
  data: { envelopeId?: string; isActive?: boolean; deletedAt?: Date },
): Promise<string> {
  const row = await prisma.regularPlan.create({
    data: {
      id: randomUUID(),
      workspaceId: w.workspaceId,
      budgetId: w.budgetId,
      name: `План ${randomUUID().slice(0, 6)}`,
      planType,
      amountMinor: 12_345n,
      anchorOn: day('2026-01-10'),
      startOn: day('2026-01-10'),
      recurrence: 'MONTHLY',
      createdByUserId: w.userId,
      updatedByUserId: w.userId,
      ...data,
    },
  });
  return row.id;
}

async function cleanup(w: World): Promise<void> {
  const where = { budgetId: w.budgetId };
  await prisma.planPayment.deleteMany({ where });
  await prisma.planOccurrence.deleteMany({ where });
  await prisma.regularPlan.deleteMany({ where });
  await prisma.transferPart.deleteMany({ where });
  await prisma.transfer.deleteMany({ where });
  await prisma.envelopeReallocation.deleteMany({ where });
  await prisma.incomeAllocation.deleteMany({ where });
  await prisma.envelopeMovement.deleteMany({ where });
  await prisma.envelopeAssignment.deleteMany({ where });
  await prisma.transaction.deleteMany({ where });
  await prisma.envelopePeriod.deleteMany({ where });
  await prisma.envelopeFundingRule.deleteMany({ where });
  await prisma.budgetCycleRevision.deleteMany({ where });
  await prisma.account.deleteMany({ where });
  await prisma.category.deleteMany({ where });
  await prisma.envelope.deleteMany({ where });
  await prisma.budget.deleteMany({ where: { id: w.budgetId } });
  await prisma.workspace.deleteMany({ where: { id: w.workspaceId } });
  await prisma.user.deleteMany({ where: { id: w.userId } });
}

describe('предпросмотр opening assignments (M02)', () => {
  const periodStart = () => '2026-01-01';

  it('без выбора владельца: assignments пусты, free = cash, старые allocations не добавляются', async () => {
    const w = await historicalWorld();
    const preview = await runPreview(prisma, w.budgetId, NO_CHOICES);
    expect(preview.assignments).toEqual([]);
    expect(preview.freeToAssignMinor).toBe('10000000');
    expect(preview.unbackedMinor).toBe('0');
    expect(preview.blockers).toEqual([]);
    const report = await runPreflight(prisma, w.budgetId);
    expect(preview.fingerprint).toBe(report.fingerprint);
    expect(report.totalCashMinor).toBe('10000000');
  });

  it('выбор opening 40000: остаток 60000, старый виртуальный баланс не применяется повторно', async () => {
    const w = await historicalWorld();
    const preview = await runPreview(prisma, w.budgetId, {
      assignments: [{ envelopeId: w.envelopeA, openingMinor: '4000000' }],
      periodTargets: [],
      fundingRules: [],
    });
    expect(preview.blockers).toEqual([]);
    expect(preview.assignments).toEqual([
      {
        envelopeId: w.envelopeA,
        periodStart: null,
        openingMinor: '4000000',
        sourceKind: 'OPENING',
      },
    ]);
    expect(preview.freeToAssignMinor).toBe('6000000');
    expect(preview.unbackedMinor).toBe('0');
    expect(await prisma.envelopeAssignment.count({ where: { budgetId: w.budgetId } })).toBe(0);
    const text = formatPreviewRu(preview);
    expect(text).toContain('40000.00');
    expect(text).toContain('60000.00');
  });

  it('отвергает чужой, архивный конверт, дубль, превышение cash, неверные суммы', async () => {
    const w = await historicalWorld();
    const other = await world();
    const archived = await envelope(w, { startingBalanceMinor: 0n, archivedAt: new Date() });
    const run = (
      assignments: { envelopeId: string; openingMinor: string; periodStart?: string }[],
    ) => runPreview(prisma, w.budgetId, { ...NO_CHOICES, assignments });

    expect((await run([{ envelopeId: other.envelopeA, openingMinor: '100' }])).blockers).toContain(
      'ENVELOPE_NOT_FOUND',
    );
    expect((await run([{ envelopeId: archived, openingMinor: '100' }])).blockers).toContain(
      'ENVELOPE_ARCHIVED',
    );
    expect(
      (
        await run([
          { envelopeId: w.envelopeA, openingMinor: '100' },
          { envelopeId: w.envelopeA, openingMinor: '200' },
        ])
      ).blockers,
    ).toContain('DUPLICATE_ASSIGNMENT');
    const over = await run([
      { envelopeId: w.envelopeA, openingMinor: '6000000' },
      { envelopeId: w.envelopeB, openingMinor: '4000001' },
    ]);
    expect(over.blockers).toContain('ASSIGNMENTS_EXCEED_CASH');
    expect(over.unbackedMinor).toBe('1');
    for (const bad of ['0', '-5', '1.5', 'abc', '']) {
      expect((await run([{ envelopeId: w.envelopeA, openingMinor: bad }])).blockers).toContain(
        'INVALID_AMOUNT',
      );
    }
  });

  it('устаревший preflight и неверный fingerprint владельца блокируют', async () => {
    const w = await historicalWorld();
    const stale = await runPreflight(prisma, w.budgetId);
    await tx(w, 'EXPENSE', 1n);
    const preview = await prisma.$transaction((t) =>
      previewMigration(t, w.budgetId, stale, NO_CHOICES),
    );
    expect(preview.blockers).toContain('STALE_PREFLIGHT');

    const fresh = await runPreview(prisma, w.budgetId, { ...NO_CHOICES, fingerprint: 'deadbeef' });
    expect(fresh.blockers).toContain('FINGERPRINT_MISMATCH');
  });

  it('периоды: только начало периода цикла и совпадение periodSlot конверта', async () => {
    const w = await historicalWorld();
    const first = await envelope(w, {
      startingBalanceMinor: 0n,
      envelopeType: 'CURRENT_EXPENSES',
      periodSlot: 'FIRST',
    });
    const run = (start: string) =>
      runPreview(prisma, w.budgetId, {
        ...NO_CHOICES,
        assignments: [{ envelopeId: first, periodStart: start, openingMinor: '100' }],
        periodTargets: [{ envelopeId: first, periodStart: start, targetMinor: '500' }],
      });

    expect((await run(periodStart())).blockers).toEqual([]);
    expect((await run('2026-01-05')).blockers).toContain('PERIOD_NOT_IN_CYCLE');
    expect((await run('2026-01-15')).blockers).toContain('PERIOD_SLOT_MISMATCH');
    expect((await run('not-a-date')).blockers).toContain('PERIOD_NOT_IN_CYCLE');
    const dup = await runPreview(prisma, w.budgetId, {
      ...NO_CHOICES,
      periodTargets: [
        { envelopeId: first, periodStart: periodStart(), targetMinor: '1' },
        { envelopeId: first, periodStart: periodStart(), targetMinor: null },
      ],
    });
    expect(dup.blockers).toContain('DUPLICATE_PERIOD_TARGET');
  });

  it('правила пополнения: SUM_OF_PLANS только для обязательных, проценты, суммы, приоритеты', async () => {
    const w = await historicalWorld();
    const mandatory = await envelope(w, {
      startingBalanceMinor: 0n,
      envelopeType: 'MANDATORY_EXPENSES',
    });
    const run = (rules: Record<string, unknown>[]) =>
      runPreview(prisma, w.budgetId, { ...NO_CHOICES, fundingRules: rules as never });

    const ok = await run([
      { envelopeId: mandatory, type: 'SUM_OF_PLANS', priority: 1 },
      {
        envelopeId: w.envelopeA,
        type: 'PERCENT_OF_INCOME',
        priority: 2,
        percentBasisPoints: 10000,
      },
      { envelopeId: w.envelopeB, type: 'SUGGESTED_FIXED', priority: 1, fixedMinor: '500' },
    ]);
    expect(ok.blockers).toEqual([]);
    expect(ok.fundingRules).toHaveLength(3);
    expect(ok.fundingRules.find((r) => r.type === 'SUGGESTED_FIXED')).toMatchObject({
      mandatory: false,
    });

    expect(
      (await run([{ envelopeId: w.envelopeA, type: 'SUM_OF_PLANS', priority: 1 }])).blockers,
    ).toContain('FUNDING_RULE_TYPE_NOT_ALLOWED');
    for (const bad of [
      { type: 'PERCENT_OF_INCOME', priority: 1, percentBasisPoints: 10001 },
      { type: 'PERCENT_OF_INCOME', priority: 1, percentBasisPoints: 1.5 },
      { type: 'PERCENT_OF_INCOME', priority: 1 },
      { type: 'FIXED_PER_PERIOD', priority: 1, fixedMinor: '0' },
      { type: 'FIXED_PER_PERIOD', priority: 1 },
      { type: 'MANUAL', priority: -1 },
      { type: 'MANUAL', priority: 1, fixedMinor: '5' },
    ]) {
      expect((await run([{ envelopeId: w.envelopeA, ...bad }])).blockers).toContain(
        'INVALID_FUNDING_RULE',
      );
    }
    expect(
      (
        await run([
          { envelopeId: w.envelopeA, type: 'MANUAL', priority: 1 },
          { envelopeId: w.envelopeA, type: 'FIXED_PER_PERIOD', priority: 1, fixedMinor: '5' },
        ])
      ).blockers,
    ).toContain('DUPLICATE_FUNDING_PRIORITY');
    const foreign = await world();
    expect(
      (await run([{ envelopeId: foreign.envelopeA, type: 'MANUAL', priority: 1 }])).blockers,
    ).toContain('ENVELOPE_NOT_FOUND');
  });

  it('цель периода: 0 допустим, число вместо строки и неизвестный тип правила отвергаются', async () => {
    const w = await historicalWorld();
    const first = await envelope(w, {
      startingBalanceMinor: 0n,
      envelopeType: 'CURRENT_EXPENSES',
      periodSlot: 'FIRST',
    });
    const target = (targetMinor: unknown) =>
      runPreview(prisma, w.budgetId, {
        ...NO_CHOICES,
        periodTargets: [{ envelopeId: first, periodStart: '2026-01-01', targetMinor }] as never,
      });
    expect((await target('0')).blockers).toEqual([]);
    expect((await target(null)).blockers).toEqual([]);
    expect((await target(500)).blockers).toContain('INVALID_AMOUNT');
    expect((await target('-1')).blockers).toContain('INVALID_AMOUNT');

    const rule = (r: Record<string, unknown>) =>
      runPreview(prisma, w.budgetId, { ...NO_CHOICES, fundingRules: [r] as never });
    expect(
      (await rule({ envelopeId: first, type: 'FIXED_PER_PERIOD', priority: 1, fixedMinor: 500 }))
        .blockers,
    ).toContain('INVALID_FUNDING_RULE');
    expect((await rule({ envelopeId: first, type: 'WHATEVER', priority: 1 })).blockers).toContain(
      'INVALID_FUNDING_RULE',
    );
  });

  it('суммарные проценты выше 100% и отрицательный cash блокируют', async () => {
    const w = await historicalWorld();
    const percent = await runPreview(prisma, w.budgetId, {
      ...NO_CHOICES,
      fundingRules: [
        {
          envelopeId: w.envelopeA,
          type: 'PERCENT_OF_INCOME',
          priority: 1,
          percentBasisPoints: 6000,
        },
        {
          envelopeId: w.envelopeB,
          type: 'PERCENT_OF_INCOME',
          priority: 1,
          percentBasisPoints: 4001,
        },
      ],
    });
    expect(percent.blockers).toContain('PERCENT_TOTAL_EXCEEDS');

    await tx(w, 'EXPENSE', 20_000_000n);
    const negative = await runPreview(prisma, w.budgetId, NO_CHOICES);
    expect(negative.blockers).toContain('NEGATIVE_TOTAL_CASH');
    expect(negative.freeToAssignMinor).toBe('0');
  });

  it('блокеры preflight попадают в предпросмотр', async () => {
    const w = await historicalWorld();
    await tx(w, 'INCOME', 1n, { occurredOn: isoDay(4) });
    const preview = await runPreview(prisma, w.budgetId, NO_CHOICES);
    expect(preview.blockers).toContain('FUTURE_CONFIRMED_FACT');
  });
});
