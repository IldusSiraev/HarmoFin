import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';
import { FinancialBalanceRepository } from '../src/common/finance/financial-balance.repository.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { PlanModelPolicy } from '../src/common/plan-model/plan-model.policy.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { todayInTimezone } from '../src/cycles/cycle-period.domain.js';
import { DirectTransferApplicationService } from '../src/v2-transfers/direct-transfer.application.service.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin_v22_test';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';
const dayMs = 86_400_000;

const d = (delta: number) => new Date(Date.now() + delta * dayMs);

// Decimal-safe bigint minor units -> "x.yy" string (never float arithmetic on money).
function minorToAmount(valueMinor: bigint): string {
  const negative = valueMinor < 0n;
  const digits = (negative ? -valueMinor : valueMinor).toString().padStart(3, '0');
  const integer = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

const emails = {
  owner: `v2-transfer-life-owner-${randomUUID()}@harmofin.test`,
  editor: `v2-transfer-life-editor-${randomUUID()}@harmofin.test`,
  viewer: `v2-transfer-life-viewer-${randomUUID()}@harmofin.test`,
  outsider: `v2-transfer-life-outsider-${randomUUID()}@harmofin.test`,
};

type RegisteredUser = { userId: string; workspaceId: string; budgetId: string };
type Context = Record<keyof typeof emails, RegisteredUser>;

let app: NestFastifyApplication;
let server: FastifyInstance;
let service: DirectTransferApplicationService;
const balances = new FinancialBalanceRepository();
const ctx: Partial<Context> = {};
let a: string;
let b: string;
let c: string;
let archived: string;
let foreign: string;
let editorAccountA: string;
let editorAccountB: string;

describe('v2 жизненный цикл прямого перевода (изменение, удаление, восстановление)', () => {
  beforeAll(async () => {
    app = await createApiApp(
      loadApiConfig({
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        WEB_ORIGIN: origin,
        AUTH_TOKEN_HASH_SECRET: 'test-only-secret-with-at-least-32-bytes',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        MAIL_FROM: 'no-reply@harmofin.test',
        WEB_BASE_URL: origin,
        LOG_LEVEL: 'silent',
      }),
    );
    await app.init();
    server = app.getHttpAdapter().getInstance() as FastifyInstance;
    await server.ready();

    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      ctx[key] = await register(emails[key]);
    }

    await prisma.budget.update({
      where: { id: ctx.owner!.budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: d(-60), timezone: 'UTC' },
    });
    await prisma.budget.update({
      where: { id: ctx.outsider!.budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: d(-60), timezone: 'UTC' },
    });

    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: ctx.owner!.workspaceId,
        userId: ctx.editor!.userId,
        role: 'EDITOR',
      },
    });
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: ctx.owner!.workspaceId,
        userId: ctx.viewer!.userId,
        role: 'VIEWER',
      },
    });

    a = await createRawAccount(ctx.owner!.budgetId, ctx.owner!.userId, 'RUB', 1_000_000n);
    b = await createRawAccount(ctx.owner!.budgetId, ctx.owner!.userId, 'RUB', 0n);
    c = await createRawAccount(ctx.owner!.budgetId, ctx.owner!.userId, 'RUB', 0n);
    archived = await createRawAccount(ctx.owner!.budgetId, ctx.owner!.userId, 'RUB', 0n);
    await prisma.account.update({ where: { id: archived }, data: { archivedAt: new Date() } });
    foreign = await createRawAccount(ctx.outsider!.budgetId, ctx.outsider!.userId, 'RUB', 0n);
    editorAccountA = await createRawAccount(
      ctx.owner!.budgetId,
      ctx.editor!.userId,
      'RUB',
      1_000_000n,
    );
    editorAccountB = await createRawAccount(ctx.owner!.budgetId, ctx.editor!.userId, 'RUB', 0n);

    service = new DirectTransferApplicationService(
      new PrismaService(databaseUrl),
      new IdempotencyService(),
      new PlanModelPolicy(new PrismaService(databaseUrl)),
    );
  });

  afterAll(async () => {
    const editor = ctx.editor;
    if (editor) {
      await prisma.workspaceMembership.deleteMany({
        where: { userId: editor.userId, workspaceId: { not: editor.workspaceId } },
      });
    }
    const viewer = ctx.viewer;
    if (viewer) {
      await prisma.workspaceMembership.deleteMany({
        where: { userId: viewer.userId, workspaceId: { not: viewer.workspaceId } },
      });
    }
    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      await cleanupUser(ctx[key]?.userId ?? '');
    }
  });

  const today = todayInTimezone(new Date(), 'UTC');
  const yesterday = new Date(Date.now() - dayMs).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + dayMs).toISOString().slice(0, 10);
  const budgetId = () => ctx.owner!.budgetId;
  const balance = (accountId: string) =>
    prisma.$transaction((tx) => balances.accountBalance(tx, budgetId(), accountId));

  async function strict(allow: boolean): Promise<void> {
    await prisma.budget.update({
      where: { id: budgetId() },
      data: { allowNegativeBalance: !allow },
    });
  }

  async function newTransfer(source: string, destination: string, amount: string) {
    return service.create(
      ctx.owner!.userId,
      budgetId(),
      { sourceAccountId: source, destinationAccountId: destination, amount, occurredOn: today },
      randomUUID(),
    );
  }

  it('изменяет сумму, дату, счета и комментарий; балансы и аудит отражают изменение', async () => {
    await strict(true);
    const created = await newTransfer(a, b, '100.00');
    const view = await service.update(
      ctx.owner!.userId,
      budgetId(),
      created.id,
      { amount: '250.00', destinationAccountId: c, occurredOn: yesterday, comment: 'Отпуск' },
      randomUUID(),
    );
    expect(view).toMatchObject({
      kind: 'TRANSFER',
      id: created.id,
      status: 'CONFIRMED',
      amountMinor: '25000',
      sourceAccountId: a,
      destinationAccountId: c,
      occurredOn: yesterday,
      comment: 'Отпуск',
      deletedAt: null,
    });
    expect(await balance(b)).toBe(0n);
    expect(await balance(c)).toBe(25_000n);
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: 'transfer', entityId: created.id, action: 'UPDATED' },
    });
    expect(event.oldValues).toMatchObject({
      totalMinor: '10000',
      destinationAccountId: b,
      comment: null,
    });
    expect(event.newValues).toMatchObject({
      totalMinor: '25000',
      destinationAccountId: c,
      comment: 'Отпуск',
    });
    expect(Object.keys(event.newValues as object)).not.toContain('sourceAccountId');
  });

  it('удаляет логически и восстанавливает; балансы возвращаются', async () => {
    const created = await newTransfer(a, b, '100.00');
    const bBefore = await balance(b);
    const removed = await service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID());
    expect(removed.status).toBe('DELETED');
    expect(removed.deletedAt).not.toBeNull();
    expect(await balance(b)).toBe(bBefore - 10_000n);
    const restored = await service.restore(ctx.owner!.userId, budgetId(), created.id, randomUUID());
    expect(restored).toMatchObject({ status: 'CONFIRMED', deletedAt: null });
    expect(await balance(b)).toBe(bBefore);
    const actions = await prisma.auditEvent.findMany({
      where: { entityType: 'transfer', entityId: created.id },
      select: { action: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(actions.map((e) => e.action)).toEqual(['CREATED', 'DELETED', 'RESTORED']);
  });

  it('строгий бюджет: удаление, уводящее счёт назначения в минус, — 409 INSUFFICIENT_BALANCE без изменений', async () => {
    await strict(true);
    // Dedicated account: `c` carries a residual balance from the first test (its destination
    // was moved there), so it is not safe to assume `c` starts at zero here.
    const target = await createRawAccount(budgetId(), ctx.owner!.userId, 'RUB', 0n);
    const created = await newTransfer(a, target, '100.00');
    // target тратит полученное: переводим всё обратно на a
    await newTransfer(target, a, '100.00');
    expect(
      await expectError(service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID())),
    ).toEqual({ status: 409, code: 'INSUFFICIENT_BALANCE' });
    expect((await prisma.transfer.findUniqueOrThrow({ where: { id: created.id } })).status).toBe(
      'CONFIRMED',
    );
  });

  it('строгий бюджет: восстановление и рост суммы проверяют счёт-источник', async () => {
    await strict(true);
    const allMinor = await balance(a);
    const big = await newTransfer(a, b, minorToAmount(allMinor)); // a = 0
    expect(
      await expectError(
        service.update(
          ctx.owner!.userId,
          budgetId(),
          big.id,
          { amount: minorToAmount(allMinor + 100n) },
          randomUUID(),
        ),
      ),
    ).toEqual({ status: 409, code: 'INSUFFICIENT_BALANCE' });
    await service.remove(ctx.owner!.userId, budgetId(), big.id, randomUUID()); // a снова полный
    await newTransfer(a, c, '1.00'); // a < суммы big
    expect(
      await expectError(service.restore(ctx.owner!.userId, budgetId(), big.id, randomUUID())),
    ).toEqual({ status: 409, code: 'INSUFFICIENT_BALANCE' });
  });

  it('нестрогий бюджет разрешает уход в минус', async () => {
    await strict(false);
    const created = await newTransfer(a, c, '1.00');
    await newTransfer(c, a, '1.00');
    const removed = await service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID());
    expect(removed.status).toBe('DELETED');
    await strict(true);
  });

  it('строгий бюджет: смена источника на пустой счёт — 409 INSUFFICIENT_BALANCE без изменений', async () => {
    await strict(true);
    const emptySource = await createRawAccount(budgetId(), ctx.owner!.userId, 'RUB', 0n);
    const created = await newTransfer(a, b, '100.00');
    const aBefore = await balance(a);
    const bBefore = await balance(b);
    const updatedAuditBefore = await prisma.auditEvent.count({
      where: { entityId: created.id, action: 'UPDATED' },
    });
    expect(
      await expectError(
        service.update(
          ctx.owner!.userId,
          budgetId(),
          created.id,
          { sourceAccountId: emptySource },
          randomUUID(),
        ),
      ),
    ).toEqual({ status: 409, code: 'INSUFFICIENT_BALANCE' });
    const row = await prisma.transfer.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.sourceAccountId).toBe(a);
    expect(row.destinationAccountId).toBe(b);
    expect(await balance(a)).toBe(aBefore);
    expect(await balance(b)).toBe(bBefore);
    expect(await balance(emptySource)).toBe(0n);
    expect(
      await prisma.auditEvent.count({ where: { entityId: created.id, action: 'UPDATED' } }),
    ).toBe(updatedAuditBefore);
  });

  it('строгий бюджет: разворот направления, когда старое назначение не покрывает двойную сумму — 409 INSUFFICIENT_BALANCE без изменений', async () => {
    await strict(true);
    const src2 = await createRawAccount(budgetId(), ctx.owner!.userId, 'RUB', 10_000n);
    const dst2 = await createRawAccount(budgetId(), ctx.owner!.userId, 'RUB', 0n);
    const created = await newTransfer(src2, dst2, '50.00'); // dst2 = 50.00, src2 = 50.00
    const src2Before = await balance(src2);
    const dst2Before = await balance(dst2);
    const updatedAuditBefore = await prisma.auditEvent.count({
      where: { entityId: created.id, action: 'UPDATED' },
    });
    // Reversal needs dst2 to cover 2x the amount (its own balance decreases by the
    // full new source debit plus losing its old incoming credit); dst2 only has the amount itself.
    expect(
      await expectError(
        service.update(
          ctx.owner!.userId,
          budgetId(),
          created.id,
          { sourceAccountId: dst2, destinationAccountId: src2 },
          randomUUID(),
        ),
      ),
    ).toEqual({ status: 409, code: 'INSUFFICIENT_BALANCE' });
    const row = await prisma.transfer.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.sourceAccountId).toBe(src2);
    expect(row.destinationAccountId).toBe(dst2);
    expect(await balance(src2)).toBe(src2Before);
    expect(await balance(dst2)).toBe(dst2Before);
    expect(
      await prisma.auditEvent.count({ where: { entityId: created.id, action: 'UPDATED' } }),
    ).toBe(updatedAuditBefore);
  });

  it('PATCH без фактических изменений (тот же комментарий) не пишет аудит UPDATED', async () => {
    const created = await service.create(
      ctx.owner!.userId,
      budgetId(),
      {
        sourceAccountId: a,
        destinationAccountId: b,
        amount: '1.00',
        occurredOn: today,
        comment: 'без изменений',
      },
      randomUUID(),
    );
    const before = await prisma.transfer.findUniqueOrThrow({ where: { id: created.id } });
    const updatedAuditBefore = await prisma.auditEvent.count({
      where: { entityId: created.id, action: 'UPDATED' },
    });
    const result = await service.update(
      ctx.owner!.userId,
      budgetId(),
      created.id,
      { comment: 'без изменений' },
      randomUUID(),
    );
    expect(result).toMatchObject({ id: created.id, comment: 'без изменений', status: 'CONFIRMED' });
    const after = await prisma.transfer.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(
      await prisma.auditEvent.count({ where: { entityId: created.id, action: 'UPDATED' } }),
    ).toBe(updatedAuditBefore);
  });

  it('валидация PATCH: одинаковые счета, будущая дата, архивный, чужой счёт', async () => {
    const created = await newTransfer(a, b, '1.00');
    const call = (input: Parameters<typeof service.update>[3]) =>
      expectError(service.update(ctx.owner!.userId, budgetId(), created.id, input, randomUUID()));
    expect(await call({ destinationAccountId: a })).toEqual({
      status: 400,
      code: 'TRANSFER_ACCOUNTS_MUST_DIFFER',
    });
    expect(await call({ occurredOn: tomorrow })).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    // requireActiveAccounts reuses the shared reference-data error: REFERENCE_INVALID, 400 here
    // (vs. 409 for the restore-time archived-account check, which is a state conflict, not input validation).
    expect(await call({ destinationAccountId: archived })).toEqual({
      status: 400,
      code: 'REFERENCE_INVALID',
    });
    expect(await call({ destinationAccountId: foreign })).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('удалённый перевод не изменяется и не удаляется повторно; восстановить можно только удалённый', async () => {
    const created = await newTransfer(a, b, '1.00');
    expect(
      await expectError(service.restore(ctx.owner!.userId, budgetId(), created.id, randomUUID())),
    ).toEqual({ status: 409, code: 'TRANSFER_NOT_DELETED' });
    await service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID());
    expect(
      await expectError(service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID())),
    ).toEqual({ status: 409, code: 'TRANSFER_ALREADY_DELETED' });
    expect(
      await expectError(
        service.update(ctx.owner!.userId, budgetId(), created.id, { comment: 'x' }, randomUUID()),
      ),
    ).toEqual({ status: 409, code: 'TRANSFER_NOT_EDITABLE' });
  });

  it('восстановление с архивным счётом — 409 REFERENCE_INVALID', async () => {
    const temp = await createRawAccount(budgetId(), ctx.owner!.userId, 'RUB', 0n);
    const created = await newTransfer(a, temp, '1.00');
    await service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID());
    await prisma.account.update({ where: { id: temp }, data: { archivedAt: new Date() } });
    expect(
      await expectError(service.restore(ctx.owner!.userId, budgetId(), created.id, randomUUID())),
    ).toEqual({ status: 409, code: 'REFERENCE_INVALID' });
  });

  it('роли: viewer — 403 на всё; только автор изменяет/удаляет/восстанавливает; чужой бюджет — 404', async () => {
    const created = await newTransfer(a, b, '1.00');
    expect(
      await expectError(
        service.update(ctx.viewer!.userId, budgetId(), created.id, { comment: 'v' }, randomUUID()),
      ),
    ).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect(
      await expectError(service.remove(ctx.viewer!.userId, budgetId(), created.id, randomUUID())),
    ).toEqual({ status: 403, code: 'FORBIDDEN' });
    // EDITOR is a writer but not this transfer's author (owner is): NOT_OPERATION_AUTHOR.
    expect(
      await expectError(
        service.update(ctx.editor!.userId, budgetId(), created.id, { comment: 'e' }, randomUUID()),
      ),
    ).toEqual({ status: 403, code: 'NOT_OPERATION_AUTHOR' });
    expect(
      await expectError(service.remove(ctx.editor!.userId, budgetId(), created.id, randomUUID())),
    ).toEqual({ status: 403, code: 'NOT_OPERATION_AUTHOR' });

    await service.update(
      ctx.owner!.userId,
      budgetId(),
      created.id,
      { comment: 'e' },
      randomUUID(),
    );
    await service.remove(ctx.owner!.userId, budgetId(), created.id, randomUUID());
    await service.restore(ctx.owner!.userId, budgetId(), created.id, randomUUID());
    expect(
      (
        await expectError(
          service.remove(ctx.outsider!.userId, budgetId(), created.id, randomUUID()),
        )
      ).status,
    ).toBe(404);
    expect(
      await expectError(
        service.remove(ctx.owner!.userId, ctx.outsider!.budgetId, created.id, randomUUID()),
      ),
    ).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });

    // The author (EDITOR) edits, deletes and restores their own transfer.
    const editorTransfer = await service.create(
      ctx.editor!.userId,
      budgetId(),
      {
        sourceAccountId: editorAccountA,
        destinationAccountId: editorAccountB,
        amount: '1.00',
        occurredOn: today,
      },
      randomUUID(),
    );
    await service.update(
      ctx.editor!.userId,
      budgetId(),
      editorTransfer.id,
      { comment: 'own' },
      randomUUID(),
    );
    await service.remove(ctx.editor!.userId, budgetId(), editorTransfer.id, randomUUID());
    await service.restore(ctx.editor!.userId, budgetId(), editorTransfer.id, randomUUID());
  });

  it('idempotency: тот же ключ и тело — тот же ответ без второго аудита; другое тело — 409', async () => {
    const created = await newTransfer(a, b, '1.00');
    const key = randomUUID();
    const first = await service.update(
      ctx.owner!.userId,
      budgetId(),
      created.id,
      { comment: 'k' },
      key,
    );
    const second = await service.update(
      ctx.owner!.userId,
      budgetId(),
      created.id,
      { comment: 'k' },
      key,
    );
    expect(second).toEqual(first);
    expect(
      await prisma.auditEvent.count({ where: { entityId: created.id, action: 'UPDATED' } }),
    ).toBe(1);
    expect(
      (
        await expectError(
          service.update(ctx.owner!.userId, budgetId(), created.id, { comment: 'z' }, key),
        )
      ).status,
    ).toBe(409);
  });
});

describe('HTTP-контракт мутаций перевода', () => {
  type FixtureUser = {
    userId: string;
    workspaceId: string;
    budgetId: string;
    cookie: string;
    csrfToken: string;
  };
  const httpEmails = {
    owner: `v2-transfer-http-owner-${randomUUID()}@harmofin.test`,
  };
  const fCtx: Partial<Record<keyof typeof httpEmails, FixtureUser>> = {};
  let httpSrcAccount: string;
  let httpDestAccount: string;

  function authCookieHeaders(user: FixtureUser | undefined): Record<string, string> {
    return { origin, cookie: `harmofin_session=${user?.cookie ?? ''}` };
  }

  function mutationHeaders(
    user: FixtureUser | undefined,
    idempotencyKey: string,
  ): Record<string, string> {
    return {
      ...authCookieHeaders(user),
      'x-csrf-token': user?.csrfToken ?? '',
      'idempotency-key': idempotencyKey,
    };
  }

  async function registerFixture(email: string): Promise<FixtureUser> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email, password },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{
      user: { id: string };
      workspace: { id: string };
      budget: { id: string };
      csrfToken: string;
    }>();
    const setCookieRaw = response.headers['set-cookie'];
    const setCookie = Array.isArray(setCookieRaw) ? setCookieRaw.join('; ') : (setCookieRaw ?? '');
    const match = /harmofin_session=([^;]+)/.exec(setCookie);
    const cookie = match ? decodeURIComponent(match[1]!) : '';
    expect(cookie).not.toHaveLength(0);
    return {
      userId: body.user.id,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
      cookie,
      csrfToken: body.csrfToken,
    };
  }

  const httpToday = todayInTimezone(new Date(), 'UTC');

  async function createViaHttp(amount: string): Promise<Record<string, unknown>> {
    const response = await server.inject({
      method: 'POST',
      url: `/api/v2/budgets/${fCtx.owner!.budgetId}/transfers`,
      headers: mutationHeaders(fCtx.owner, randomUUID()),
      payload: {
        sourceAccountId: httpSrcAccount,
        destinationAccountId: httpDestAccount,
        amount,
        occurredOn: httpToday,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json<Record<string, unknown>>();
  }

  beforeAll(async () => {
    for (const key of Object.keys(httpEmails) as Array<keyof typeof httpEmails>) {
      fCtx[key] = await registerFixture(httpEmails[key]);
    }
    await prisma.budget.update({
      where: { id: fCtx.owner!.budgetId },
      data: { planModelVersion: 2, planModelActivatedOn: d(-60), timezone: 'UTC' },
    });
    httpSrcAccount = await createRawAccount(
      fCtx.owner!.budgetId,
      fCtx.owner!.userId,
      'RUB',
      10_000_000n,
    );
    httpDestAccount = await createRawAccount(fCtx.owner!.budgetId, fCtx.owner!.userId, 'RUB', 0n);
  });

  afterAll(async () => {
    for (const key of Object.keys(httpEmails) as Array<keyof typeof httpEmails>) {
      await cleanupUser(fCtx[key]?.userId ?? '');
    }
    await app.close();
    await prisma.$disconnect();
  });

  const owner = () => fCtx.owner!;

  it('PATCH → 200 с kind TRANSFER; без Idempotency-Key → 400; без CSRF → 403', async () => {
    const created = await createViaHttp('3.00');
    const url = `/api/v2/budgets/${owner().budgetId}/transfers/${created.id}`;
    const ok = await server.inject({
      method: 'PATCH',
      url,
      headers: mutationHeaders(owner(), randomUUID()),
      payload: { comment: 'HTTP' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ kind: 'TRANSFER', id: created.id, comment: 'HTTP' });

    const noKey = await server.inject({
      method: 'PATCH',
      url,
      headers: { ...authCookieHeaders(owner()), 'x-csrf-token': owner().csrfToken },
      payload: { comment: 'x' },
    });
    expect(noKey.statusCode).toBe(400);

    const noCsrf = await server.inject({
      method: 'PATCH',
      url,
      headers: { ...authCookieHeaders(owner()), 'idempotency-key': randomUUID() },
      payload: { comment: 'x' },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('PATCH с пустым телом или лишним полем → 400; transferId не uuid → 400', async () => {
    const created = await createViaHttp('1.00');
    const url = `/api/v2/budgets/${owner().budgetId}/transfers/${created.id}`;
    for (const payload of [{}, { status: 'DELETED' }]) {
      const response = await server.inject({
        method: 'PATCH',
        url,
        headers: mutationHeaders(owner(), randomUUID()),
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    const bad = await server.inject({
      method: 'PATCH',
      url: `/api/v2/budgets/${owner().budgetId}/transfers/not-a-uuid`,
      headers: mutationHeaders(owner(), randomUUID()),
      payload: { comment: 'x' },
    });
    expect(bad.statusCode).toBe(400);

    // A malformed budgetId path param must be a 400 Problem Details response,
    // not a PrismaClientValidationError surfaced as a 500.
    const badBudget = await server.inject({
      method: 'PATCH',
      url: `/api/v2/budgets/not-a-uuid/transfers/${created.id}`,
      headers: mutationHeaders(owner(), randomUUID()),
      payload: { comment: 'x' },
    });
    expect(badBudget.statusCode).toBe(400);
  });

  it('DELETE → 200 DELETED; POST restore → 200 CONFIRMED', async () => {
    const created = await createViaHttp('1.00');
    const url = `/api/v2/budgets/${owner().budgetId}/transfers/${created.id}`;
    const removed = await server.inject({
      method: 'DELETE',
      url,
      headers: mutationHeaders(owner(), randomUUID()),
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ status: 'DELETED' });
    const restored = await server.inject({
      method: 'POST',
      url: `${url}/restore`,
      headers: mutationHeaders(owner(), randomUUID()),
      payload: {},
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ status: 'CONFIRMED', deletedAt: null });
  });
});

async function register(email: string): Promise<RegisteredUser> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{
    user: { id: string };
    workspace: { id: string };
    budget: { id: string };
    csrfToken: string;
  }>();
  return {
    userId: body.user.id,
    workspaceId: body.workspace.id,
    budgetId: body.budget.id,
  };
}

async function createRawAccount(
  budgetId: string,
  ownerUserId: string,
  currency: string,
  startingBalanceMinor: bigint,
): Promise<string> {
  const account = await prisma.account.create({
    data: {
      id: randomUUID(),
      budgetId,
      ownerUserId,
      name: `Счёт ${randomUUID().slice(0, 8)}`,
      accountType: 'BANK_ACCOUNT',
      currency,
      scale: 2,
      startingBalanceMinor,
      accountingStartDate: d(-90),
    },
  });
  return account.id;
}

async function cleanupUser(userId: string): Promise<void> {
  if (!userId) return;
  await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.recoveryToken.deleteMany({ where: { userId } });
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    select: { workspaceId: true },
  });
  await prisma.workspaceMembership.deleteMany({ where: { userId } });
  for (const { workspaceId } of memberships) {
    // Editor/viewer actions leave audit rows on the owner's budget too; a cleanup scoped only
    // to this user's own actorUserId would otherwise leave a dangling FK on budget deletion.
    await prisma.auditEvent.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.idempotencyRecord.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeMovement.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeAssignment.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.incomeAllocation.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.transferPart.deleteMany({
      where: { transfer: { budget: { workspaceId } } },
    });
    await prisma.transfer.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopePeriod.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelopeFundingRule.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budgetCycleRevision.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.transaction.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.updateMany({
      where: { workspaceId },
      data: {
        incomeAllocationSourceCategoryId: null,
        incomeAllocationTargetEnvelopeId: null,
      },
    });
    await prisma.account.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.category.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.envelope.deleteMany({ where: { budget: { workspaceId } } });
    await prisma.budget.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}

async function expectError(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    const exception = error as { getStatus?: () => number; getResponse?: () => unknown };
    const response =
      typeof exception.getResponse === 'function' ? exception.getResponse() : undefined;
    const body =
      typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : {};
    return {
      status: typeof exception.getStatus === 'function' ? exception.getStatus() : 0,
      code: typeof body.code === 'string' ? body.code : '',
    };
  }
  throw new Error('Expected error was not thrown');
}
