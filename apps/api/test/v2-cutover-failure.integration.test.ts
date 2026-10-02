import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { FinancialBalanceRepository } from '../src/common/finance/financial-balance.repository.js';
import { cutover } from '../src/migrations/envelope-v2/cutover.js';
import {
  CliUsageError,
  describeTarget,
  loadApproval,
  parseArgs,
} from '../src/migrations/envelope-v2/cli.js';
import { runPreflight } from '../src/migrations/envelope-v2/preflight.js';
import { assertDisposableDatabase } from './helpers/disposable-db.js';

const databaseUrl = assertDisposableDatabase(process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const noFreeze = { checkFreeze: async () => undefined };

type Fixture = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  accountId: string;
  envelopeId: string;
  archivedEnvelopeId: string;
};

const fixtures: Fixture[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    const where = { budgetId: f.budgetId };
    await prisma.idempotencyRecord.deleteMany({ where });
    await prisma.auditEvent.deleteMany({ where: { workspaceId: f.workspaceId } });
    await prisma.envelopeAssignment.deleteMany({ where });
    await prisma.envelopePeriod.deleteMany({ where });
    await prisma.envelopeFundingRule.deleteMany({ where });
    await prisma.transaction.deleteMany({ where });
    await prisma.account.deleteMany({ where });
    await prisma.category.deleteMany({ where });
    await prisma.envelope.deleteMany({ where });
    await prisma.budget.deleteMany({ where: { id: f.budgetId } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: f.workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: f.workspaceId } });
    await prisma.user.deleteMany({ where: { id: f.userId } });
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('откат переключения при ошибке (M03)', () => {
  const state = async (f: Fixture) => {
    const where = { budgetId: f.budgetId };
    const repo = new FinancialBalanceRepository();
    return {
      accounts: await prisma.account.findMany({
        where: { budgetId: f.budgetId },
        orderBy: { id: 'asc' },
      }),
      version: (await prisma.budget.findUniqueOrThrow({ where: { id: f.budgetId } }))
        .planModelVersion,
      activatedOn: (await prisma.budget.findUniqueOrThrow({ where: { id: f.budgetId } }))
        .planModelActivatedOn,
      cash: await prisma.$transaction((t) => repo.accountBalance(t, f.budgetId, f.accountId)),
      counts: await Promise.all([
        prisma.envelopeAssignment.count({ where }),
        prisma.envelopePeriod.count({ where }),
        prisma.envelopeFundingRule.count({ where }),
        prisma.idempotencyRecord.count({ where }),
        prisma.auditEvent.count({ where }),
        prisma.transaction.count({ where }),
      ]),
    };
  };
  const params = async (f: Fixture, overrides: Record<string, unknown> = {}) => ({
    budgetId: f.budgetId,
    ownerId: f.userId,
    approvedFingerprint: (await runPreflight(prisma, f.budgetId)).fingerprint,
    approvedAssignments: [{ envelopeId: f.envelopeId, openingMinor: '1000' }],
    approvedPeriodTargets: [],
    approvedFundingRules: [],
    dryRun: false,
    ...overrides,
  });

  it('устаревший fingerprint: ничего не создано, версия 1, остатки равны', async () => {
    const f = await fixture();
    const base = await params(f);
    await prisma.account.update({ where: { id: f.accountId }, data: { name: 'Изменён' } });
    const before = await state(f);

    await expect(cutover(prisma, base, noFreeze)).rejects.toMatchObject({
      code: 'STALE_FINGERPRINT',
    });

    expect(await state(f)).toEqual(before);
    expect(before.version).toBe(1);
  });

  it('недопустимое назначение (архивный конверт, превышение cash): откат всего', async () => {
    const f = await fixture();
    const before = await state(f);

    await expect(
      cutover(
        prisma,
        await params(f, {
          approvedAssignments: [{ envelopeId: f.archivedEnvelopeId, openingMinor: '1000' }],
        }),
        noFreeze,
      ),
    ).rejects.toMatchObject({ code: 'PREVIEW_BLOCKED', blockers: ['ENVELOPE_ARCHIVED'] });
    await expect(
      cutover(
        prisma,
        await params(f, {
          approvedAssignments: [{ envelopeId: f.envelopeId, openingMinor: '999999999' }],
        }),
        noFreeze,
      ),
    ).rejects.toMatchObject({ code: 'PREVIEW_BLOCKED' });

    expect(await state(f)).toEqual(before);
  });

  it('сбой посреди записи (периоды созданы, затем ошибка) откатывает периоды и назначения', async () => {
    const f = await fixture();
    const before = await state(f);

    await expect(
      cutover(
        prisma,
        await params(f, {
          approvedPeriodTargets: [
            { envelopeId: f.envelopeId, periodStart: '2026-01-01', targetMinor: '500' },
          ],
        }),
        { ...noFreeze, afterWrites: () => Promise.reject(new Error('injected')) },
      ),
    ).rejects.toThrow('injected');

    expect(await state(f)).toEqual(before);
  });

  it('двойное правило на конверт отвергается до записи', async () => {
    const f = await fixture();
    const before = await state(f);
    await expect(
      cutover(
        prisma,
        await params(f, {
          approvedFundingRules: [
            { envelopeId: f.envelopeId, type: 'MANUAL', priority: 1 },
            { envelopeId: f.envelopeId, type: 'SUGGESTED_FIXED', priority: 2, fixedMinor: '5' },
          ],
        }),
        noFreeze,
      ),
    ).rejects.toMatchObject({ code: 'PREVIEW_BLOCKED' });
    expect(await state(f)).toEqual(before);
  });

  it('бюджет уже в модели 2 без сохранённого результата отвергается', async () => {
    const f = await fixture();
    const base = await params(f);
    await prisma.budget.update({
      where: { id: f.budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: new Date('2026-01-01') },
    });
    const before = await state(f);
    await expect(cutover(prisma, base, noFreeze)).rejects.toMatchObject({
      code: 'PLAN_MODEL_NOT_V1',
    });
    expect(await state(f)).toEqual(before);
  });
});

describe('CLI: разбор аргументов и файла согласования', () => {
  const uuid = randomUUID();

  it('по умолчанию dry-run; apply требует --maintenance-ack', () => {
    expect(parseArgs(['--budget-id', uuid, '--approval-file', 'a.json'])).toMatchObject({
      apply: false,
      maintenanceAck: false,
    });
    expect(() => parseArgs(['--budget-id', uuid, '--approval-file', 'a.json', '--apply'])).toThrow(
      CliUsageError,
    );
    expect(
      parseArgs(['--budget-id', uuid, '--approval-file', 'a.json', '--apply', '--maintenance-ack']),
    ).toMatchObject({ apply: true, maintenanceAck: true });
    expect(() =>
      parseArgs([
        '--budget-id',
        uuid,
        '--approval-file',
        'a.json',
        '--apply',
        '--dry-run',
        '--maintenance-ack',
      ]),
    ).toThrow(CliUsageError);
  });

  it('отвергает неверный uuid, неизвестные и недостающие аргументы', () => {
    expect(() => parseArgs(['--budget-id', 'x', '--approval-file', 'a.json'])).toThrow(
      CliUsageError,
    );
    expect(() => parseArgs(['--budget-id', uuid])).toThrow(CliUsageError);
    expect(() => parseArgs(['--budget-id', uuid, '--approval-file', 'a', '--bogus'])).toThrow(
      CliUsageError,
    );
    expect(parseArgs(['--help'])).toMatchObject({ help: true });
  });

  it('loadApproval проверяет форму и совпадение budgetId', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cutover-'));
    dirs.push(dir);
    const file = join(dir, 'approval.json');
    const body = {
      budgetId: uuid,
      ownerId: randomUUID(),
      fingerprint: 'a'.repeat(64),
      assignments: [],
      periodTargets: [],
      fundingRules: [],
    };
    writeFileSync(file, JSON.stringify(body));
    expect(loadApproval(file, uuid)).toMatchObject({ budgetId: uuid, approvedAssignments: [] });
    expect(() => loadApproval(file, randomUUID())).toThrow(/APPROVAL_BUDGET_MISMATCH/);

    writeFileSync(file, JSON.stringify({ ...body, assignments: 'x' }));
    expect(() => loadApproval(file, uuid)).toThrow(/APPROVAL_FILE_INVALID/);
    writeFileSync(file, '{not json');
    expect(() => loadApproval(file, uuid)).toThrow(/APPROVAL_FILE_INVALID/);
    expect(() => loadApproval(join(dir, 'missing.json'), uuid)).toThrow(/APPROVAL_FILE_INVALID/);
  });

  it('describeTarget выводит только host и базу без пароля', () => {
    expect(describeTarget('postgresql://user:secret@db.local:5432/mydb?x=1')).toBe(
      'db.local:5432/mydb',
    );
    expect(describeTarget('postgresql://user:secret@db.local:5432/mydb')).not.toContain('secret');
  });
});

async function fixture(): Promise<Fixture> {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const budgetId = randomUUID();
  await prisma.user.create({
    data: { id: userId, email: `v2-cutfail-${userId}@harmofin.test`, passwordHash: 'x' },
  });
  await prisma.workspace.create({
    data: { id: workspaceId, ownerId: userId, name: 'Cutover', timezone: 'UTC' },
  });
  await prisma.workspaceMembership.create({
    data: { id: randomUUID(), workspaceId, userId, role: 'OWNER' },
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
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
      name: 'Счёт',
      accountType: 'BANK_ACCOUNT',
      startingBalanceMinor: 50_000n,
      accountingStartDate: day('2020-01-01'),
    },
  });
  const envelope = (archived: boolean) =>
    prisma.envelope.create({
      data: {
        id: randomUUID(),
        budgetId,
        name: `Е ${randomUUID().slice(0, 6)}`,
        envelopeType: 'CUSTOM',
        startingBalanceMinor: 0n,
        displayOrder: 950,
        ...(archived ? { archivedAt: new Date() } : {}),
      },
    });
  const active = await envelope(false);
  const archived = await envelope(true);
  const f = {
    userId,
    workspaceId,
    budgetId,
    accountId: account.id,
    envelopeId: active.id,
    archivedEnvelopeId: archived.id,
  };
  fixtures.push(f);
  return f;
}
