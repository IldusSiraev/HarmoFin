# Envelope Reallocation & Period-Leftover Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user move money from one envelope to another without an account transfer, and proactively prompt them on the dashboard when a just-ended financial period's envelope still holds a nonzero balance.

**Architecture:** A new `EnvelopeReallocation` Prisma entity + `apps/api/src/envelope-reallocations/` module (repository/application-service/controller, mirroring `apps/api/src/transfers/`) provides the server-confirmed, audited, budget-isolated envelope-to-envelope movement. `FinancialBalanceRepository.envelopeBalance` and the dashboard's `periodEnvelopeSummary` SQL are extended to include confirmed reallocations. `DashboardRepository`/`DashboardApplicationService` gain a `previousPeriodLeftover` field computed from data already fetched for the dashboard. The web app renders a new `PeriodLeftoverPrompt.vue` banner next to `DashboardWarnings.vue` with two explicit actions, both calling the new endpoint.

**Tech Stack:** NestJS/Fastify, Prisma/PostgreSQL, Zod, Nuxt 4/Vue 3, Vitest, Supertest-style `server.inject`, Playwright.

**Spec:** [docs/superpowers/specs/2026-09-26-envelope-reallocation-period-leftover-design.md](../specs/2026-09-26-envelope-reallocation-period-leftover-design.md)

## Global Constraints

- Money is stored as PostgreSQL `BIGINT` minor units; API accepts/returns decimal strings; never use floating point.
- Only `CONFIRMED` records affect balance projections. Logical deletion only (`deletedAt`), no hard delete.
- Every query filters `budget_id` (and via it `workspace_id`/membership) in the database query itself.
- All financial mutations require an `Idempotency-Key` header and use the existing `IdempotencyService`.
- Mutating routes require role `OWNER` or `EDITOR`; reads require any active membership. Cross-budget IDs return `404 RESOURCE_NOT_FOUND`.
- `EnvelopeReallocation` source and destination envelopes must differ, be active, belong to the same budget, and be `RUB`/`scale = 2`.
- Capacity check (`allowNegativeBalance === false`) must block a reallocation that would push the source envelope negative — same `INSUFFICIENT_BALANCE` code used by transfers/transactions.
- All new user-facing UI text is in Russian. Code identifiers stay in English.
- Do not modify `Transfer`/`TransferPart` or relax the "accounts must differ" rule.
- Follow `docs/superpowers/specs/2026-09-17-calm-fintech-visual-guidelines.md` for the new banner's visual treatment.

---

## File Structure

**Create:**
- `apps/api/src/envelope-reallocations/envelope-reallocation.repository.ts`
- `apps/api/src/envelope-reallocations/envelope-reallocation.application.service.ts`
- `apps/api/src/envelope-reallocations/envelope-reallocation.application.service.test.ts`
- `apps/api/src/envelope-reallocations/envelope-reallocation.schemas.ts`
- `apps/api/src/envelope-reallocations/envelope-reallocation.dto.ts`
- `apps/api/src/envelope-reallocations/envelope-reallocation.controller.ts`
- `apps/api/src/envelope-reallocations/envelope-reallocation.module.ts`
- `apps/api/test/envelope-reallocations.integration.test.ts`
- `apps/web/app/components/dashboard/PeriodLeftoverPrompt.vue`
- `apps/web/app/components/dashboard/PeriodLeftoverPrompt.test.ts`
- `e2e/period-leftover.spec.ts`

**Modify:**
- `prisma/schema.prisma`
- `apps/api/src/common/finance/financial-balance.repository.ts`
- `apps/api/src/common/finance/financial-balance.repository.test.ts`
- `apps/api/src/dashboard/dashboard.repository.ts`
- `apps/api/src/dashboard/dashboard.application.service.ts`
- `apps/api/src/dashboard/dashboard.application.service.test.ts`
- `apps/api/test/dashboard-summary.integration.test.ts`
- `apps/api/src/app.module.ts`
- `apps/web/app/composables/useBudgetReferenceData.ts`
- `apps/web/app/pages/app/index.vue`
- `apps/web/app/pages/app/index.test.ts`

---

### Task 1: Prisma schema, migration and envelope balance projection

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `apps/api/src/common/finance/financial-balance.repository.ts`
- Modify: `apps/api/src/common/finance/financial-balance.repository.test.ts`

**Interfaces:**
- Produces: enum `EnvelopeReallocationStatus` (`CONFIRMED` | `DELETED`), Prisma model `EnvelopeReallocation` mapped to table `envelope_reallocations`, and `FinancialBalanceRepository.envelopeBalance` now includes confirmed reallocations. Later tasks depend on the Prisma Client types `Prisma.EnvelopeReallocationGetPayload`, `EnvelopeReallocationStatus`, and on `tx.envelopeReallocation.*`.

- [ ] **Step 1: Write the failing assertion for the extended envelope balance SQL**

Edit `apps/api/src/common/finance/financial-balance.repository.test.ts`, extending the first `it` block's envelope assertions:

```ts
    expect(envelopeSql).toContain('"income_allocations"');
    expect(envelopeSql).toContain('"transfer_parts"');
    expect(envelopeSql).toContain('"source_envelope_id"');
    expect(envelopeSql).toContain('"destination_envelope_id"');
    expect(envelopeSql).toContain('"envelope_reallocations"');
    expect(envelopeSql).toContain('"status" = \'CONFIRMED\'');
    expect(envelopeSql).toContain('::uuid');
```

(Only the `expect(envelopeSql).toContain('"envelope_reallocations"');` line is new — insert it after the `"transfer_parts"` assertion.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @harmofin/api test -- financial-balance.repository.test.ts`
Expected: FAIL — `envelopeSql` does not contain `"envelope_reallocations"`.

- [ ] **Step 3: Add the Prisma model**

Edit `prisma/schema.prisma`. Add the enum next to the other status enums (near `enum TransferStatus`, around line 89):

```prisma
enum EnvelopeReallocationStatus {
  CONFIRMED
  DELETED
}
```

Add the model after `model TransferPart` (after line 466, before `model RegularPlan`):

```prisma
model EnvelopeReallocation {
  id                    String                     @id @db.Uuid
  budgetId              String                     @map("budget_id") @db.Uuid
  status                EnvelopeReallocationStatus @default(CONFIRMED)
  sourceEnvelopeId      String                     @map("source_envelope_id") @db.Uuid
  destinationEnvelopeId String                     @map("destination_envelope_id") @db.Uuid
  amountMinor           BigInt                     @map("amount_minor")
  currency              String                     @default("RUB") @db.Char(3)
  scale                 Int                        @default(2) @db.SmallInt
  occurredOn            DateTime                   @map("occurred_on") @db.Date
  comment               String?                    @db.VarChar(500)
  deletedAt             DateTime?                  @map("deleted_at") @db.Timestamptz(3)
  createdByUserId       String                     @map("created_by_user_id") @db.Uuid
  updatedByUserId       String                     @map("updated_by_user_id") @db.Uuid
  createdAt             DateTime                   @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt             DateTime                   @updatedAt @map("updated_at") @db.Timestamptz(3)

  budget              Budget   @relation(fields: [budgetId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  sourceEnvelope      Envelope @relation("EnvelopeReallocationSource", fields: [sourceEnvelopeId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)
  destinationEnvelope Envelope @relation("EnvelopeReallocationDestination", fields: [destinationEnvelopeId, budgetId], references: [id, budgetId], onDelete: Restrict, onUpdate: Cascade)

  @@unique([id, budgetId])
  @@index([budgetId, sourceEnvelopeId])
  @@index([budgetId, destinationEnvelopeId])
  @@index([budgetId, occurredOn])
  @@map("envelope_reallocations")
}
```

In `model Budget` (around line 246, next to `transfers Transfer[]`), add:

```prisma
  envelopeReallocations EnvelopeReallocation[]
```

In `model Envelope` (around line 335, next to `transferPartsAsDestination`), add:

```prisma
  envelopeReallocationsAsSource      EnvelopeReallocation[] @relation("EnvelopeReallocationSource")
  envelopeReallocationsAsDestination EnvelopeReallocation[] @relation("EnvelopeReallocationDestination")
```

- [ ] **Step 4: Generate the migration and Prisma Client**

Run: `pnpm db:migrate:dev --name add_envelope_reallocations`
Expected: a new folder under `prisma/migrations/` is created and applied to the local database; `pnpm db:generate` runs automatically as part of `db:migrate:dev` (Prisma regenerates the client).

- [ ] **Step 5: Extend `envelopeBalance` with reallocation terms**

Edit `apps/api/src/common/finance/financial-balance.repository.ts`, inside `envelopeBalance`'s big expression, immediately after the existing `transfer_parts` destination-envelope `+ COALESCE(...)` block (after line 106, before the closing `)::BIGINT AS "balanceMinor"`):

```ts
          - COALESCE((
            SELECT SUM(reallocation."amount_minor")
            FROM "envelope_reallocations" AS reallocation
            WHERE reallocation."budget_id" = ${budgetId}::uuid
              AND reallocation."source_envelope_id" = ${envelopeId}::uuid
              AND reallocation."status" = 'CONFIRMED'
          ), 0)
          + COALESCE((
            SELECT SUM(reallocation."amount_minor")
            FROM "envelope_reallocations" AS reallocation
            WHERE reallocation."budget_id" = ${budgetId}::uuid
              AND reallocation."destination_envelope_id" = ${envelopeId}::uuid
              AND reallocation."status" = 'CONFIRMED'
          ), 0)
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @harmofin/api test -- financial-balance.repository.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations apps/api/src/common/finance/financial-balance.repository.ts apps/api/src/common/finance/financial-balance.repository.test.ts
git commit -m "feat(api): add EnvelopeReallocation model and include it in envelope balance"
```

---

### Task 2: Envelope reallocation repository

**Files:**
- Create: `apps/api/src/envelope-reallocations/envelope-reallocation.repository.ts`

**Interfaces:**
- Consumes: `PrismaService` (`../database/prisma.service.js`), `FinancialBalanceRepository` (`../common/finance/financial-balance.repository.js`), `createUuidV7` (`../common/identifiers/uuid-v7.js`).
- Produces (consumed by Task 3): `EnvelopeReallocationRecord`, `EnvelopeReallocationCreateData`, `EnvelopeReallocationListQuery`, `EnvelopeReallocationListResult`, and class `EnvelopeReallocationRepository` with methods `findAccessibleWithRole(userId, budgetId)`, `list(userId, budgetId, query)`, `find(userId, budgetId, id)`, `findForMutation(tx, userId, budgetId, id)`, `findActiveReferences(tx, budgetId, sourceEnvelopeId, destinationEnvelopeId)`, `assertReallocationCapacity(tx, budgetId, sourceEnvelopeId, amountMinor)`, `create(tx, data, userId, requestId?)`, `markDeleted(tx, current, userId, requestId?)`, `runTransaction(write)`.

This is a data-access layer with no business branching, so it is verified by the Task 5 integration test rather than an isolated unit test (the same approach `TransferRepository` uses — it has no dedicated `.test.ts` file).

- [ ] **Step 1: Write the repository**

Create `apps/api/src/envelope-reallocations/envelope-reallocation.repository.ts`:

```ts
import { Prisma, type EnvelopeReallocationStatus } from '@prisma/client';

import { FinancialBalanceRepository } from '../common/finance/financial-balance.repository.js';
import { createUuidV7 } from '../common/identifiers/uuid-v7.js';
import { PrismaService } from '../database/prisma.service.js';

export interface EnvelopeReallocationRecord {
  id: string;
  budgetId: string;
  status: EnvelopeReallocationStatus;
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amountMinor: bigint;
  currency: string;
  scale: number;
  occurredOn: Date;
  comment: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  sourceEnvelopeCurrentBalanceMinor: bigint;
  destinationEnvelopeCurrentBalanceMinor: bigint;
}

export interface EnvelopeReallocationCreateData {
  budgetId: string;
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amountMinor: bigint;
  occurredOn: Date;
  comment: string | null;
  createdByUserId: string;
  updatedByUserId: string;
}

export interface EnvelopeReallocationListQuery {
  limit: number;
  cursor?: string;
  envelopeId?: string;
  from?: Date;
  to?: Date;
}

export interface EnvelopeReallocationListResult {
  items: EnvelopeReallocationRecord[];
  nextCursor: string | null;
}

export class EnvelopeReallocationRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balances = new FinancialBalanceRepository(),
  ) {}

  runTransaction<T>(write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(write);
  }

  async findAccessibleWithRole(userId: string, budgetId: string) {
    return this.prisma.budget.findFirst({
      where: activeBudgetWhere(userId, budgetId),
      select: {
        id: true,
        workspaceId: true,
        allowNegativeBalance: true,
        workspace: {
          select: {
            memberships: { where: { userId, isActive: true }, select: { role: true }, take: 1 },
          },
        },
      },
    });
  }

  async list(
    userId: string,
    budgetId: string,
    query: EnvelopeReallocationListQuery,
  ): Promise<EnvelopeReallocationListResult> {
    return this.prisma.$transaction(async (tx) => {
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await tx.envelopeReallocation.findMany({
        where: {
          budgetId,
          budget: activeBudgetWhere(userId, budgetId),
          ...(query.from || query.to
            ? {
                occurredOn: {
                  ...(query.from ? { gte: query.from } : {}),
                  ...(query.to ? { lte: query.to } : {}),
                },
              }
            : {}),
          AND: [
            ...(query.envelopeId
              ? [
                  {
                    OR: [
                      { sourceEnvelopeId: query.envelopeId },
                      { destinationEnvelopeId: query.envelopeId },
                    ],
                  },
                ]
              : []),
            ...(cursor
              ? [
                  {
                    OR: [
                      { occurredOn: { lt: cursor.occurredOn } },
                      { occurredOn: cursor.occurredOn, createdAt: { lt: cursor.createdAt } },
                      {
                        occurredOn: cursor.occurredOn,
                        createdAt: cursor.createdAt,
                        id: { lt: cursor.id },
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
        select: envelopeReallocationSelect,
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const hasNext = rows.length > query.limit;
      const page = hasNext ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);
      return {
        items: await Promise.all(page.map((row) => this.withConsequences(tx, row))),
        nextCursor: hasNext && last ? encodeCursor(last) : null,
      };
    });
  }

  async find(
    userId: string,
    budgetId: string,
    id: string,
  ): Promise<EnvelopeReallocationRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.envelopeReallocation.findFirst({
        where: { id, budgetId, budget: activeBudgetWhere(userId, budgetId) },
        select: envelopeReallocationSelect,
      });
      return row ? this.withConsequences(tx, row) : null;
    });
  }

  async findForMutation(
    tx: Prisma.TransactionClient,
    userId: string,
    budgetId: string,
    id: string,
  ): Promise<EnvelopeReallocationRecord | null> {
    const accessible = await tx.envelopeReallocation.findFirst({
      where: { id, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: { id: true },
    });
    if (!accessible) return null;
    await tx.$queryRaw`
      SELECT "id" FROM "envelope_reallocations"
      WHERE "id" = ${id}::uuid AND "budget_id" = ${budgetId}::uuid
      FOR UPDATE
    `;
    const row = await tx.envelopeReallocation.findFirst({
      where: { id, budgetId, budget: activeBudgetWhere(userId, budgetId) },
      select: envelopeReallocationSelect,
    });
    return row ? this.withConsequences(tx, row) : null;
  }

  async findActiveReferences(
    tx: Prisma.TransactionClient,
    budgetId: string,
    sourceEnvelopeId: string,
    destinationEnvelopeId: string,
  ) {
    const envelopeIds = [sourceEnvelopeId, destinationEnvelopeId];
    await tx.$queryRaw`
      SELECT "id" FROM "envelopes"
      WHERE "budget_id" = ${budgetId}::uuid
        AND "id" IN (${Prisma.join(envelopeIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "id"
      FOR UPDATE
    `;
    const envelopes = await tx.envelope.findMany({
      where: { budgetId, id: { in: envelopeIds }, archivedAt: null },
      select: { id: true, budgetId: true, archivedAt: true, currency: true, scale: true },
    });
    return {
      sourceEnvelope: envelopes.find((envelope) => envelope.id === sourceEnvelopeId) ?? null,
      destinationEnvelope:
        envelopes.find((envelope) => envelope.id === destinationEnvelopeId) ?? null,
    };
  }

  async assertReallocationCapacity(
    tx: Prisma.TransactionClient,
    budgetId: string,
    sourceEnvelopeId: string,
    amountMinor: bigint,
  ): Promise<boolean> {
    const balance = await this.balances.envelopeBalance(tx, budgetId, sourceEnvelopeId);
    return balance >= amountMinor;
  }

  async create(
    tx: Prisma.TransactionClient,
    data: EnvelopeReallocationCreateData,
    userId: string,
    requestId?: string,
  ): Promise<EnvelopeReallocationRecord> {
    const [budget, record] = await Promise.all([
      tx.budget.findUniqueOrThrow({ where: { id: data.budgetId }, select: { workspaceId: true } }),
      tx.envelopeReallocation.create({
        data: {
          id: createUuidV7(),
          budgetId: data.budgetId,
          sourceEnvelopeId: data.sourceEnvelopeId,
          destinationEnvelopeId: data.destinationEnvelopeId,
          amountMinor: data.amountMinor,
          occurredOn: data.occurredOn,
          comment: data.comment,
          createdByUserId: data.createdByUserId,
          updatedByUserId: data.updatedByUserId,
        },
        select: envelopeReallocationSelect,
      }),
    ]);
    await tx.auditEvent.create({
      data: auditCreate(budget.workspaceId, record, userId, requestId, 'CREATED'),
    });
    return this.withConsequences(tx, record);
  }

  async markDeleted(
    tx: Prisma.TransactionClient,
    current: EnvelopeReallocationRecord,
    userId: string,
    requestId?: string,
  ): Promise<EnvelopeReallocationRecord> {
    const record = await tx.envelopeReallocation.update({
      where: { id: current.id },
      data: { status: 'DELETED', deletedAt: new Date(), updatedByUserId: userId },
      select: envelopeReallocationSelect,
    });
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: current.budgetId },
      select: { workspaceId: true },
    });
    await tx.auditEvent.create({
      data: auditCreate(budget.workspaceId, record, userId, requestId, 'DELETED', current),
    });
    return this.withConsequences(tx, record);
  }

  private async withConsequences(
    tx: Prisma.TransactionClient,
    row: Omit<
      EnvelopeReallocationRecord,
      'sourceEnvelopeCurrentBalanceMinor' | 'destinationEnvelopeCurrentBalanceMinor'
    >,
  ): Promise<EnvelopeReallocationRecord> {
    const [sourceEnvelopeCurrentBalanceMinor, destinationEnvelopeCurrentBalanceMinor] =
      await Promise.all([
        this.balances.envelopeBalance(tx, row.budgetId, row.sourceEnvelopeId),
        this.balances.envelopeBalance(tx, row.budgetId, row.destinationEnvelopeId),
      ]);
    return { ...row, sourceEnvelopeCurrentBalanceMinor, destinationEnvelopeCurrentBalanceMinor };
  }
}

function activeBudgetWhere(userId: string, budgetId: string) {
  return {
    id: budgetId,
    status: 'ACTIVE' as const,
    workspace: {
      status: 'ACTIVE' as const,
      memberships: { some: { userId, isActive: true } },
    },
  };
}

type EnvelopeReallocationAuditRecord = Pick<
  EnvelopeReallocationRecord,
  'id' | 'budgetId' | 'status' | 'sourceEnvelopeId' | 'destinationEnvelopeId' | 'amountMinor' | 'occurredOn'
>;

function auditValues(record: EnvelopeReallocationAuditRecord) {
  return {
    status: record.status,
    sourceEnvelopeId: record.sourceEnvelopeId,
    destinationEnvelopeId: record.destinationEnvelopeId,
    amountMinor: record.amountMinor.toString(),
    occurredOn: record.occurredOn.toISOString().slice(0, 10),
  };
}

function auditCreate(
  workspaceId: string,
  record: EnvelopeReallocationAuditRecord,
  userId: string,
  requestId: string | undefined,
  action: string,
  previous?: EnvelopeReallocationRecord,
) {
  return {
    id: createUuidV7(),
    actorUserId: userId,
    workspaceId,
    budgetId: record.budgetId,
    entityType: 'envelope_reallocation',
    entityId: record.id,
    action,
    source: 'API',
    requestId: requestId ?? null,
    ...(previous ? { oldValues: auditValues(previous) } : {}),
    newValues: auditValues(record),
  };
}

function encodeCursor(row: { occurredOn: Date; createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({
      occurredOn: row.occurredOn.toISOString(),
      createdAt: row.createdAt.toISOString(),
      id: row.id,
    }),
  ).toString('base64url');
}

function decodeCursor(value: string): { occurredOn: Date; createdAt: Date; id: string } {
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
    occurredOn: string;
    createdAt: string;
    id: string;
  };
  return {
    occurredOn: new Date(parsed.occurredOn),
    createdAt: new Date(parsed.createdAt),
    id: parsed.id,
  };
}

const envelopeReallocationSelect = {
  id: true,
  budgetId: true,
  status: true,
  sourceEnvelopeId: true,
  destinationEnvelopeId: true,
  amountMinor: true,
  currency: true,
  scale: true,
  occurredOn: true,
  comment: true,
  deletedAt: true,
  createdAt: true,
} as const;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @harmofin/api typecheck`
Expected: no errors (this file has no test of its own; correctness is verified end-to-end in Task 5).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/envelope-reallocations/envelope-reallocation.repository.ts
git commit -m "feat(api): add envelope reallocation repository"
```

---

### Task 3: Envelope reallocation application service and schemas

**Files:**
- Create: `apps/api/src/envelope-reallocations/envelope-reallocation.schemas.ts`
- Create: `apps/api/src/envelope-reallocations/envelope-reallocation.application.service.ts`
- Test: `apps/api/src/envelope-reallocations/envelope-reallocation.application.service.test.ts`

**Interfaces:**
- Consumes: `EnvelopeReallocationRepository` and its exported types (Task 2), `IdempotencyService` (`../common/idempotency/idempotency.service.js`), `formatMinorUnits`/`parseDecimalToMinorUnits` (`../common/money/minor-units.js`), `forbidden`/`invalidReference`/`resourceNotFound` (`../common/reference-data/reference-data.errors.js`).
- Produces (consumed by Task 4): `EnvelopeReallocationApplicationService` with `list(userId, budgetId, input)`, `get(userId, budgetId, id)`, `create(userId, budgetId, input, key, requestId?)`, `delete(userId, budgetId, id, key, requestId?)`, all returning `EnvelopeReallocationView`/`EnvelopeReallocationListView`. Also `createEnvelopeReallocationSchema`, `listEnvelopeReallocationsSchema`, `CreateEnvelopeReallocationInput`, `ListEnvelopeReallocationsInput`.

- [ ] **Step 1: Write the schemas**

Create `apps/api/src/envelope-reallocations/envelope-reallocation.schemas.ts`:

```ts
import { z } from 'zod';

const amount = z.string().min(1).max(64);
const date = z.string().date();
const uuid = z.string().uuid();
const comment = z.string().trim().min(1).max(500).nullable().optional();

export const createEnvelopeReallocationSchema = z
  .object({
    sourceEnvelopeId: uuid,
    destinationEnvelopeId: uuid,
    amount,
    occurredOn: date,
    comment,
  })
  .strict();

export const listEnvelopeReallocationsSchema = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    envelopeId: uuid.optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .strict();

export type CreateEnvelopeReallocationInput = z.output<typeof createEnvelopeReallocationSchema>;
export type ListEnvelopeReallocationsInput = z.output<typeof listEnvelopeReallocationsSchema>;
```

- [ ] **Step 2: Write the failing unit tests**

Create `apps/api/src/envelope-reallocations/envelope-reallocation.application.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { EnvelopeReallocationApplicationService } from './envelope-reallocation.application.service.js';
import type { CreateEnvelopeReallocationInput } from './envelope-reallocation.schemas.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const viewerId = '00000000-0000-4000-8000-000000000002';
const budgetId = '00000000-0000-4000-8000-000000000003';
const recordId = '00000000-0000-4000-8000-000000000004';
const sourceEnvelopeId = '00000000-0000-4000-8000-000000000005';
const destinationEnvelopeId = '00000000-0000-4000-8000-000000000006';

describe('EnvelopeReallocationApplicationService', () => {
  it('creates a confirmed reallocation with canonical minor units', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget(false));
    repository.findActiveReferences.mockResolvedValue(activeReferences());
    repository.create.mockResolvedValue(record());
    const service = createService(repository);

    await expect(
      service.create(ownerId, budgetId, reallocationInput(), 'create-key'),
    ).resolves.toMatchObject({ status: 'CONFIRMED', amountMinor: '3500' });
    expect(repository.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amountMinor: 3_500n, sourceEnvelopeId, destinationEnvelopeId }),
      ownerId,
      undefined,
    );
  });

  it('rejects identical source and destination envelopes', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget(false));
    const service = createService(repository);

    await expect(
      service.create(
        ownerId,
        budgetId,
        reallocationInput({ destinationEnvelopeId: sourceEnvelopeId }),
        'same-envelope-key',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ENVELOPE_REALLOCATION_ENVELOPES_MUST_DIFFER' }),
    });
  });

  it('rejects archived or foreign envelope references', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget(false));
    repository.findActiveReferences.mockResolvedValue({
      ...activeReferences(),
      destinationEnvelope: null,
    });
    const service = createService(repository);

    await expect(
      service.create(ownerId, budgetId, reallocationInput(), 'foreign-reference-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REFERENCE_INVALID' }),
    });
  });

  it('blocks a reallocation that exceeds source envelope capacity', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget(false));
    repository.findActiveReferences.mockResolvedValue(activeReferences());
    repository.assertReallocationCapacity.mockResolvedValue(false);
    const service = createService(repository);

    await expect(
      service.create(ownerId, budgetId, reallocationInput(), 'capacity-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }),
    });
  });

  it('allows a negative source envelope when the budget allows negative balances', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget(true));
    repository.findActiveReferences.mockResolvedValue(activeReferences());
    repository.create.mockResolvedValue(record());
    const service = createService(repository);

    await expect(
      service.create(ownerId, budgetId, reallocationInput(), 'allow-negative-key'),
    ).resolves.toMatchObject({ status: 'CONFIRMED' });
    expect(repository.assertReallocationCapacity).not.toHaveBeenCalled();
  });

  it('rejects viewer financial mutations', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue({
      id: budgetId,
      allowNegativeBalance: false,
      workspace: { memberships: [{ role: 'VIEWER' }] },
    });
    const service = createService(repository);

    await expect(
      service.create(viewerId, budgetId, reallocationInput(), 'viewer-key'),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FORBIDDEN' }) });
  });

  it('deletes a confirmed reallocation and blocks a second delete', async () => {
    const repository = repositoryDouble();
    repository.findAccessibleWithRole.mockResolvedValue(accessibleBudget(false));
    repository.findForMutation.mockResolvedValueOnce(record());
    repository.markDeleted.mockResolvedValueOnce(record({ status: 'DELETED' }));
    repository.findForMutation.mockResolvedValueOnce(record({ status: 'DELETED' }));
    const service = createService(repository);

    await expect(
      service.delete(ownerId, budgetId, recordId, 'delete-key'),
    ).resolves.toMatchObject({ status: 'DELETED' });
    await expect(
      service.delete(ownerId, budgetId, recordId, 'delete-again-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ENVELOPE_REALLOCATION_STATE_INVALID' }),
    });
  });

  function createService(repository: ReturnType<typeof repositoryDouble>) {
    return new EnvelopeReallocationApplicationService(
      repository as never,
      {
        execute: async (_tx: unknown, _input: unknown, write: () => Promise<unknown>) => write(),
      } as never,
    );
  }

  function repositoryDouble() {
    return {
      findAccessibleWithRole: vi.fn(),
      runTransaction: vi.fn(async (write: (tx: object) => Promise<unknown>) => write({})),
      findActiveReferences: vi.fn(),
      assertReallocationCapacity: vi.fn().mockResolvedValue(true),
      create: vi.fn(),
      findForMutation: vi.fn(),
      markDeleted: vi.fn(),
      list: vi.fn(),
      find: vi.fn(),
    };
  }

  function accessibleBudget(allowNegativeBalance: boolean) {
    return {
      id: budgetId,
      allowNegativeBalance,
      workspace: { memberships: [{ role: 'OWNER' }] },
    };
  }

  function activeReferences() {
    return {
      sourceEnvelope: {
        id: sourceEnvelopeId,
        budgetId,
        archivedAt: null,
        currency: 'RUB',
        scale: 2,
      },
      destinationEnvelope: {
        id: destinationEnvelopeId,
        budgetId,
        archivedAt: null,
        currency: 'RUB',
        scale: 2,
      },
    };
  }

  function reallocationInput(
    overrides: Partial<CreateEnvelopeReallocationInput> = {},
  ): CreateEnvelopeReallocationInput {
    return {
      sourceEnvelopeId,
      destinationEnvelopeId,
      amount: '35.00',
      occurredOn: '2026-09-26',
      ...overrides,
    };
  }

  function record(overrides: Record<string, unknown> = {}) {
    return {
      id: recordId,
      budgetId,
      status: 'CONFIRMED',
      sourceEnvelopeId,
      destinationEnvelopeId,
      amountMinor: 3_500n,
      currency: 'RUB',
      scale: 2,
      occurredOn: new Date('2026-09-26T00:00:00.000Z'),
      comment: null,
      deletedAt: null,
      createdAt: new Date('2026-09-26T00:00:00.000Z'),
      sourceEnvelopeCurrentBalanceMinor: 0n,
      destinationEnvelopeCurrentBalanceMinor: 0n,
      ...overrides,
    };
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @harmofin/api test -- envelope-reallocation.application.service.test.ts`
Expected: FAIL — `./envelope-reallocation.application.service.js` does not exist yet.

- [ ] **Step 4: Write the application service**

Create `apps/api/src/envelope-reallocations/envelope-reallocation.application.service.ts`:

```ts
import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { formatMinorUnits, parseDecimalToMinorUnits } from '../common/money/minor-units.js';
import {
  forbidden,
  invalidReference,
  resourceNotFound,
} from '../common/reference-data/reference-data.errors.js';
import {
  EnvelopeReallocationRepository,
  type EnvelopeReallocationCreateData,
  type EnvelopeReallocationListQuery,
  type EnvelopeReallocationRecord,
} from './envelope-reallocation.repository.js';
import type {
  CreateEnvelopeReallocationInput,
  ListEnvelopeReallocationsInput,
} from './envelope-reallocation.schemas.js';

export interface EnvelopeReallocationView {
  [key: string]: unknown;
  id: string;
  budgetId: string;
  status: 'CONFIRMED' | 'DELETED';
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  occurredOn: string;
  comment: string | null;
  deletedAt: string | null;
  sourceEnvelopeCurrentBalanceMinor: string;
  destinationEnvelopeCurrentBalanceMinor: string;
}

export interface EnvelopeReallocationListView {
  items: EnvelopeReallocationView[];
  nextCursor: string | null;
}

@Injectable()
export class EnvelopeReallocationApplicationService {
  constructor(
    private readonly repository: EnvelopeReallocationRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(
    userId: string,
    budgetId: string,
    input: ListEnvelopeReallocationsInput,
  ): Promise<EnvelopeReallocationListView> {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const result = await this.repository.list(userId, budgetId, listQuery(input));
    return {
      items: result.items.map((record) => this.toView(record)),
      nextCursor: result.nextCursor,
    };
  }

  async get(userId: string, budgetId: string, id: string): Promise<EnvelopeReallocationView> {
    const record = await this.repository.find(userId, budgetId, id);
    if (!record) throw resourceNotFound();
    return this.toView(record);
  }

  async create(
    userId: string,
    budgetId: string,
    input: CreateEnvelopeReallocationInput,
    key: string,
    requestId?: string,
  ): Promise<EnvelopeReallocationView> {
    const budget = await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<EnvelopeReallocationView>(
        tx,
        idempotencyInput(budgetId, userId, key, 'envelope-reallocation.create', input),
        async () => {
          const data = await this.createData(
            tx,
            budgetId,
            userId,
            input,
            budget.allowNegativeBalance,
          );
          const record = await this.repository.create(tx, data, userId, requestId);
          return { status: 201, body: this.toView(record) };
        },
      );
      return result.body;
    });
  }

  async delete(
    userId: string,
    budgetId: string,
    id: string,
    key: string,
    requestId?: string,
  ): Promise<EnvelopeReallocationView> {
    await this.requireMutationBudget(userId, budgetId);
    return this.repository.runTransaction(async (tx) => {
      const result = await this.idempotency.execute<EnvelopeReallocationView>(
        tx,
        idempotencyInput(budgetId, userId, key, `envelope-reallocation.delete:${id}`, {}),
        async () => {
          const current = await this.requireMutableRecord(tx, userId, budgetId, id);
          if (current.status === 'DELETED') throw invalidState();
          const record = await this.repository.markDeleted(tx, current, userId, requestId);
          return { status: 200, body: this.toView(record) };
        },
      );
      return result.body;
    });
  }

  toView(record: EnvelopeReallocationRecord): EnvelopeReallocationView {
    return {
      id: record.id,
      budgetId: record.budgetId,
      status: record.status,
      sourceEnvelopeId: record.sourceEnvelopeId,
      destinationEnvelopeId: record.destinationEnvelopeId,
      amountMinor: formatMinorUnits(record.amountMinor),
      currency: 'RUB',
      scale: 2,
      occurredOn: record.occurredOn.toISOString().slice(0, 10),
      comment: record.comment,
      deletedAt: record.deletedAt?.toISOString() ?? null,
      sourceEnvelopeCurrentBalanceMinor: formatMinorUnits(record.sourceEnvelopeCurrentBalanceMinor),
      destinationEnvelopeCurrentBalanceMinor: formatMinorUnits(
        record.destinationEnvelopeCurrentBalanceMinor,
      ),
    };
  }

  private async createData(
    tx: Parameters<EnvelopeReallocationRepository['findActiveReferences']>[0],
    budgetId: string,
    userId: string,
    input: CreateEnvelopeReallocationInput,
    allowNegativeBalance: boolean,
  ): Promise<EnvelopeReallocationCreateData> {
    if (input.sourceEnvelopeId === input.destinationEnvelopeId) throw envelopesMustDiffer();
    const amountMinor = parsePositiveAmount(input.amount);

    const references = await this.repository.findActiveReferences(
      tx,
      budgetId,
      input.sourceEnvelopeId,
      input.destinationEnvelopeId,
    );
    if (
      !isActiveRubReference(references.sourceEnvelope) ||
      !isActiveRubReference(references.destinationEnvelope)
    ) {
      throw invalidReference();
    }

    if (!allowNegativeBalance) {
      const capacity = await this.repository.assertReallocationCapacity(
        tx,
        budgetId,
        input.sourceEnvelopeId,
        amountMinor,
      );
      if (!capacity) throw insufficientBalance();
    }

    return {
      budgetId,
      sourceEnvelopeId: input.sourceEnvelopeId,
      destinationEnvelopeId: input.destinationEnvelopeId,
      amountMinor,
      occurredOn: new Date(`${input.occurredOn}T00:00:00.000Z`),
      comment: input.comment ?? null,
      createdByUserId: userId,
      updatedByUserId: userId,
    };
  }

  private async requireMutationBudget(userId: string, budgetId: string) {
    const budget = await this.repository.findAccessibleWithRole(userId, budgetId);
    if (!budget) throw resourceNotFound();
    const role = budget.workspace.memberships[0]?.role;
    if (role !== 'OWNER' && role !== 'EDITOR') throw forbidden();
    return budget;
  }

  private async requireMutableRecord(
    tx: Parameters<EnvelopeReallocationRepository['findForMutation']>[0],
    userId: string,
    budgetId: string,
    id: string,
  ): Promise<EnvelopeReallocationRecord> {
    const record = await this.repository.findForMutation(tx, userId, budgetId, id);
    if (!record) throw resourceNotFound();
    return record;
  }
}

function listQuery(input: ListEnvelopeReallocationsInput): EnvelopeReallocationListQuery {
  return {
    limit: input.limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.envelopeId ? { envelopeId: input.envelopeId } : {}),
    ...(input.from ? { from: new Date(`${input.from}T00:00:00.000Z`) } : {}),
    ...(input.to ? { to: new Date(`${input.to}T00:00:00.000Z`) } : {}),
  };
}

function idempotencyInput(
  budgetId: string,
  actorUserId: string,
  key: string,
  operation: string,
  body: unknown,
) {
  return {
    budgetId,
    actorUserId,
    key,
    operation,
    requestHash: createHash(operation, body),
  };
}

function createHash(operation: string, body: unknown): string {
  return require('node:crypto')
    .createHash('sha256')
    .update(JSON.stringify({ operation, body }))
    .digest('hex');
}

function parsePositiveAmount(value: string): bigint {
  const amount = parseDecimalToMinorUnits(value, 2, false);
  if (amount <= 0n) throw invalidReference();
  return amount;
}

function isActiveRubReference(
  reference: { archivedAt: Date | null; currency: string; scale: number } | null,
): boolean {
  return reference?.archivedAt === null && reference.currency === 'RUB' && reference.scale === 2;
}

function envelopesMustDiffer(): BadRequestException {
  return new BadRequestException({
    code: 'ENVELOPE_REALLOCATION_ENVELOPES_MUST_DIFFER',
    detail: 'Конверт списания и конверт зачисления должны различаться.',
    fieldErrors: [
      {
        field: 'destinationEnvelopeId',
        message: 'Выберите другой конверт зачисления.',
        code: 'invalid',
      },
    ],
  });
}

function insufficientBalance(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'INSUFFICIENT_BALANCE',
    detail: 'Недостаточно средств в конверте списания.',
  });
}

function invalidState(): ConflictException {
  return new ConflictException({
    code: 'ENVELOPE_REALLOCATION_STATE_INVALID',
    detail: 'Перенос между конвертами уже удалён.',
  });
}
```

Replace the `createHash`/`require` helper with the same `node:crypto` import style `transfer.application.service.ts` uses, to keep the module ESM-clean — edit the top of the file:

```ts
import { createHash } from 'node:crypto';
```

and simplify `idempotencyInput`:

```ts
function idempotencyInput(
  budgetId: string,
  actorUserId: string,
  key: string,
  operation: string,
  body: unknown,
) {
  return {
    budgetId,
    actorUserId,
    key,
    operation,
    requestHash: createHash('sha256').update(JSON.stringify({ operation, body })).digest('hex'),
  };
}
```

(and delete the standalone `createHash(operation, body)` function defined above it).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @harmofin/api test -- envelope-reallocation.application.service.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/envelope-reallocations/envelope-reallocation.schemas.ts apps/api/src/envelope-reallocations/envelope-reallocation.application.service.ts apps/api/src/envelope-reallocations/envelope-reallocation.application.service.test.ts
git commit -m "feat(api): add envelope reallocation application service"
```

---

### Task 4: Envelope reallocation controller, DTOs and module wiring

**Files:**
- Create: `apps/api/src/envelope-reallocations/envelope-reallocation.dto.ts`
- Create: `apps/api/src/envelope-reallocations/envelope-reallocation.controller.ts`
- Create: `apps/api/src/envelope-reallocations/envelope-reallocation.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `EnvelopeReallocationApplicationService` (Task 3), `SessionAuthGuard`, `CsrfGuard`, `ZodValidationPipe`, `ProblemDetailsResponse`, `RequestContext` (same paths `transfer.controller.ts` uses).
- Produces: routes `GET/POST /api/v1/budgets/:budgetId/envelope-reallocations`, `GET/DELETE /api/v1/budgets/:budgetId/envelope-reallocations/:id`, registered via `EnvelopeReallocationModule.register()` in `app.module.ts`. Verified end-to-end in Task 5.

- [ ] **Step 1: Write the DTOs**

Create `apps/api/src/envelope-reallocations/envelope-reallocation.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const decimalPattern = '^(0|[1-9]\\d*)(?:\\.\\d+)?$';
const minorPattern = '^-?\\d+$';

export class CreateEnvelopeReallocationRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  sourceEnvelopeId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  destinationEnvelopeId!: string;

  @ApiProperty({ type: String, pattern: decimalPattern })
  amount!: string;

  @ApiProperty({ type: String, format: 'date' })
  occurredOn!: string;

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  comment?: string | null;
}

export class EnvelopeReallocationResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ enum: ['CONFIRMED', 'DELETED'] })
  status!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  sourceEnvelopeId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  destinationEnvelopeId!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  amountMinor!: string;

  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: Number, enum: [2] })
  scale!: 2;

  @ApiProperty({ type: String, format: 'date' })
  occurredOn!: string;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  deletedAt!: string | null;

  @ApiProperty({ type: String, pattern: minorPattern })
  sourceEnvelopeCurrentBalanceMinor!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  destinationEnvelopeCurrentBalanceMinor!: string;
}

export class EnvelopeReallocationListResponse {
  @ApiProperty({ type: [EnvelopeReallocationResponse] })
  items!: EnvelopeReallocationResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
```

- [ ] **Step 2: Write the controller**

Create `apps/api/src/envelope-reallocations/envelope-reallocation.controller.ts`:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { EnvelopeReallocationApplicationService } from './envelope-reallocation.application.service.js';
import {
  CreateEnvelopeReallocationRequest,
  EnvelopeReallocationListResponse,
  EnvelopeReallocationResponse,
} from './envelope-reallocation.dto.js';
import {
  createEnvelopeReallocationSchema,
  type CreateEnvelopeReallocationInput,
  type ListEnvelopeReallocationsInput,
  listEnvelopeReallocationsSchema,
} from './envelope-reallocation.schemas.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

@ApiTags('envelope-reallocations')
@Controller()
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
export class EnvelopeReallocationController {
  constructor(
    @Inject(EnvelopeReallocationApplicationService)
    private readonly service: EnvelopeReallocationApplicationService,
  ) {}

  @Get('budgets/:budgetId/envelope-reallocations')
  @ApiOkResponse({ type: EnvelopeReallocationListResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  list(
    @Param('budgetId') budgetId: string,
    @Query(new ZodValidationPipe(listEnvelopeReallocationsSchema))
    query: ListEnvelopeReallocationsInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.list(contextOf(request).userId, budgetId, query);
  }

  @Post('budgets/:budgetId/envelope-reallocations')
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiBody({ type: CreateEnvelopeReallocationRequest })
  @ApiCreatedResponse({ type: EnvelopeReallocationResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  create(
    @Param('budgetId') budgetId: string,
    @Body(new ZodValidationPipe(createEnvelopeReallocationSchema))
    input: CreateEnvelopeReallocationInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.create(
      contextOf(request).userId,
      budgetId,
      input,
      validKey(key),
      request.id,
    );
  }

  @Get('budgets/:budgetId/envelope-reallocations/:id')
  @ApiOkResponse({ type: EnvelopeReallocationResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  get(
    @Param('budgetId') budgetId: string,
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.get(contextOf(request).userId, budgetId, id);
  }

  @Delete('budgets/:budgetId/envelope-reallocations/:id')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiOkResponse({ type: EnvelopeReallocationResponse })
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 404, type: ProblemDetailsResponse })
  @ApiResponse({ status: 409, type: ProblemDetailsResponse })
  delete(
    @Param('budgetId') budgetId: string,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.service.delete(
      contextOf(request).userId,
      budgetId,
      id,
      validKey(key),
      request.id,
    );
  }
}

function validKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 128 || !/^[\x20-\x7e]+$/.test(key)) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: 'Некорректный ключ идемпотентности.',
      fieldErrors: [
        { field: 'Idempotency-Key', message: 'Укажите корректный ключ.', code: 'invalid' },
      ],
    });
  }
  return key;
}

function contextOf(request: AuthenticatedRequest): RequestContext {
  if (!request.authContext) throw new Error('Missing authenticated request context.');
  return request.authContext;
}
```

- [ ] **Step 3: Write the module**

Create `apps/api/src/envelope-reallocations/envelope-reallocation.module.ts`:

```ts
import { type DynamicModule, Module } from '@nestjs/common';

import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { EnvelopeReallocationApplicationService } from './envelope-reallocation.application.service.js';
import { EnvelopeReallocationController } from './envelope-reallocation.controller.js';
import { EnvelopeReallocationRepository } from './envelope-reallocation.repository.js';

@Module({})
export class EnvelopeReallocationModule {
  static register(): DynamicModule {
    return {
      module: EnvelopeReallocationModule,
      controllers: [EnvelopeReallocationController],
      providers: [
        {
          provide: EnvelopeReallocationRepository,
          useFactory: (prisma: PrismaService) => new EnvelopeReallocationRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: EnvelopeReallocationApplicationService,
          useFactory: (repository: EnvelopeReallocationRepository) =>
            new EnvelopeReallocationApplicationService(repository, new IdempotencyService()),
          inject: [EnvelopeReallocationRepository],
        },
      ],
    };
  }
}
```

- [ ] **Step 4: Register the module**

Edit `apps/api/src/app.module.ts`. Add the import next to `TransferModule`:

```ts
import { EnvelopeReallocationModule } from './envelope-reallocations/envelope-reallocation.module.js';
```

Add `EnvelopeReallocationModule.register(),` to the imports array right after `TransferModule.register(),`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @harmofin/api typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/envelope-reallocations/envelope-reallocation.dto.ts apps/api/src/envelope-reallocations/envelope-reallocation.controller.ts apps/api/src/envelope-reallocations/envelope-reallocation.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): expose envelope reallocation routes"
```

---

### Task 5: Envelope reallocation integration test

**Files:**
- Create: `apps/api/test/envelope-reallocations.integration.test.ts`

**Interfaces:**
- Consumes: `createApiApp` (`../src/app.js`), `loadApiConfig` (`../src/config/env.js`) — same bootstrap as `apps/api/test/transfers.integration.test.ts`.
- Produces: none (leaf verification task).

- [ ] **Step 1: Write the integration test**

Create `apps/api/test/envelope-reallocations.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app.js';
import { loadApiConfig } from '../src/config/env.js';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const origin = 'http://localhost:3000';
const password = 'correct-password-10';

let app: NestFastifyApplication;
let server: FastifyInstance;
let owner: Session;
let foreign: Session;

type Session = {
  userId: string;
  workspaceId: string;
  budgetId: string;
  cookie: string;
  csrfToken: string;
};

type References = { sourceEnvelopeId: string; destinationEnvelopeId: string };

describe('envelope reallocations API', () => {
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
    owner = await register(`envelope-realloc-owner-${randomUUID()}@harmofin.test`);
    foreign = await register(`envelope-realloc-foreign-${randomUUID()}@harmofin.test`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await cleanup(foreign);
    await app.close();
    await prisma.$disconnect();
  });

  it('documents envelope reallocation routes and idempotency headers in OpenAPI', async () => {
    const document = (await server.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<
        string,
        Record<string, { parameters?: Array<{ name: string; required?: boolean }> }>
      >;
    }>();
    const collection = '/api/v1/budgets/{budgetId}/envelope-reallocations';
    const item = '/api/v1/budgets/{budgetId}/envelope-reallocations/{id}';

    expect(document.paths[collection]?.get).toBeDefined();
    expect(document.paths[collection]?.post).toBeDefined();
    expect(document.paths[item]?.get).toBeDefined();
    for (const [path, method] of [
      [collection, 'post'],
      [item, 'delete'],
    ] as const) {
      expect(document.paths[path]?.[method]?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Idempotency-Key', required: true }),
        ]),
      );
    }
  });

  it('moves money between envelopes without touching any account', async () => {
    const refs = await createReferences('move');
    const created = await createReallocation(
      refs,
      { amount: '150.00', occurredOn: '2026-09-26' },
      'realloc-move',
    );

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'CONFIRMED',
      sourceEnvelopeId: refs.sourceEnvelopeId,
      destinationEnvelopeId: refs.destinationEnvelopeId,
      amountMinor: '15000',
    });
    await expectEnvelopeBalance(refs.sourceEnvelopeId, '35000');
    await expectEnvelopeBalance(refs.destinationEnvelopeId, '15000');
    expect(
      (await listReallocations()).json<{ items: Array<{ id: string }> }>().items,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.json<{ id: string }>().id })]));
  });

  it('rejects identical envelopes, archived or foreign references, and insufficient capacity', async () => {
    const refs = await createReferences('validation');
    const before = await prisma.envelopeReallocation.count({ where: { budgetId: owner.budgetId } });
    const sameEnvelope = await createReallocation(
      refs,
      { destinationEnvelopeId: refs.sourceEnvelopeId },
      'realloc-same-envelope',
    );
    const insufficient = await createReallocation(
      refs,
      { amount: '1000.01' },
      'realloc-insufficient',
    );
    await prisma.envelope.update({
      where: { id: refs.sourceEnvelopeId },
      data: { archivedAt: new Date() },
    });
    const archived = await createReallocation(refs, { amount: '1.00' }, 'realloc-archived');
    const foreignRefs = await createReferences('foreign', foreign);
    const foreignResponse = await createReallocation(
      { ...refs, sourceEnvelopeId: foreignRefs.sourceEnvelopeId },
      { amount: '1.00' },
      'realloc-foreign-reference',
    );

    expect(sameEnvelope.statusCode).toBe(400);
    expect(sameEnvelope.json()).toMatchObject({ code: 'ENVELOPE_REALLOCATION_ENVELOPES_MUST_DIFFER' });
    expect(insufficient.statusCode).toBe(422);
    expect(insufficient.json()).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(archived.statusCode).toBe(400);
    expect(foreignResponse.statusCode).toBe(400);
    await expect(
      prisma.envelopeReallocation.count({ where: { budgetId: owner.budgetId } }),
    ).resolves.toBe(before);
  });

  it('logically deletes a reallocation and preserves the audit trail', async () => {
    const refs = await createReferences('lifecycle');
    const created = await createReallocation(refs, { amount: '10.00' }, 'realloc-lifecycle');
    const id = created.json<{ id: string }>().id;
    const deleted = await deleteReallocation(id, 'realloc-delete');

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ status: 'DELETED' });
    await expectEnvelopeBalance(refs.sourceEnvelopeId, '50000');
    await expectEnvelopeBalance(refs.destinationEnvelopeId, '0');
    await expect(
      prisma.auditEvent.count({
        where: {
          budgetId: owner.budgetId,
          entityType: 'envelope_reallocation',
          entityId: id,
          action: 'DELETED',
        },
      }),
    ).resolves.toBe(1);
  });

  it('replays same idempotency request once and rejects changed payload', async () => {
    const refs = await createReferences('retry');
    const payload = { amount: '10.00', occurredOn: '2026-09-26' };
    const before = await prisma.envelopeReallocation.count({ where: { budgetId: owner.budgetId } });
    const first = await createReallocation(refs, payload, 'realloc-retry');
    const replay = await createReallocation(refs, payload, 'realloc-retry');
    const conflict = await createReallocation(refs, { amount: '11.00' }, 'realloc-retry');

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      prisma.envelopeReallocation.count({ where: { budgetId: owner.budgetId } }),
    ).resolves.toBe(before + 1);
  });

  it('permits editor, rejects viewer and hides another budget', async () => {
    const refs = await createReferences('role');
    await setRole('EDITOR');
    const editor = await createReallocation(refs, { amount: '1.00' }, 'realloc-editor');
    await setRole('VIEWER');
    const viewer = await createReallocation(refs, { amount: '1.00' }, 'realloc-viewer');
    await setRole('OWNER');
    const foreignList = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelope-reallocations`,
      cookies: { harmofin_session: foreign.cookie },
    });
    const unauthenticated = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelope-reallocations`,
    });

    expect(editor.statusCode).toBe(201);
    expect(viewer.statusCode).toBe(403);
    expect(foreignList.statusCode).toBe(404);
    expect(unauthenticated.statusCode).toBe(401);
  });

  async function createReferences(suffix: string, session = owner): Promise<References> {
    const sourceEnvelope = await createEnvelope(session, `Источник переноса ${suffix}`, '500.00', 0);
    const destinationEnvelope = await createEnvelope(
      session,
      `Назначение переноса ${suffix}`,
      '0.00',
      1,
    );
    return {
      sourceEnvelopeId: sourceEnvelope.json<{ id: string }>().id,
      destinationEnvelopeId: destinationEnvelope.json<{ id: string }>().id,
    };
  }

  function createReallocation(
    refs: References,
    overrides: Record<string, unknown>,
    key: string,
    session = owner,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${session.budgetId}/envelope-reallocations`,
      headers: { origin, 'x-csrf-token': session.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: session.cookie },
      payload: {
        sourceEnvelopeId: refs.sourceEnvelopeId,
        destinationEnvelopeId: refs.destinationEnvelopeId,
        amount: '10.00',
        occurredOn: '2026-09-26',
        ...overrides,
      },
    });
  }

  function listReallocations() {
    return server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelope-reallocations`,
      cookies: { harmofin_session: owner.cookie },
    });
  }

  function deleteReallocation(id: string, key: string) {
    return server.inject({
      method: 'DELETE',
      url: `/api/v1/budgets/${owner.budgetId}/envelope-reallocations/${id}`,
      headers: { origin, 'x-csrf-token': owner.csrfToken, 'idempotency-key': key },
      cookies: { harmofin_session: owner.cookie },
    });
  }

  async function createEnvelope(
    session: Session,
    name: string,
    startingBalance: string,
    displayOrder: number,
  ) {
    return server.inject({
      method: 'POST',
      url: `/api/v1/budgets/${session.budgetId}/envelopes`,
      headers: { origin, 'x-csrf-token': session.csrfToken },
      cookies: { harmofin_session: session.cookie },
      payload: { name, envelopeType: 'CUSTOM', currency: 'RUB', startingBalance, displayOrder },
    });
  }

  async function expectEnvelopeBalance(envelopeId: string, expected: string) {
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/budgets/${owner.budgetId}/envelopes/${envelopeId}`,
      cookies: { harmofin_session: owner.cookie },
    });
    expect(response.json<{ currentBalanceMinor: string }>().currentBalanceMinor).toBe(expected);
  }

  async function setRole(role: 'OWNER' | 'EDITOR' | 'VIEWER') {
    await prisma.workspaceMembership.updateMany({
      where: { workspaceId: owner.workspaceId, userId: owner.userId },
      data: { role },
    });
  }

  async function register(email: string): Promise<Session> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email, password },
    });
    const body = response.json<{
      user: { id: string };
      workspace: { id: string };
      budget: { id: string };
      csrfToken: string;
    }>();
    const cookie = response.cookies.find((item) => item.name === 'harmofin_session')?.value;
    if (!cookie) throw new Error('Missing session cookie');
    return {
      userId: body.user.id,
      workspaceId: body.workspace.id,
      budgetId: body.budget.id,
      csrfToken: body.csrfToken,
      cookie,
    };
  }

  async function cleanup(session: Session) {
    if (!session) return;
    const budgetIds = (
      await prisma.budget.findMany({
        where: { workspaceId: session.workspaceId },
        select: { id: true },
      })
    ).map((budget) => budget.id);
    await prisma.auditEvent.deleteMany({ where: { workspaceId: session.workspaceId } });
    await prisma.idempotencyRecord.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.envelopeReallocation.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transferPart.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transfer.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.incomeAllocation.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.transaction.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.account.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.category.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.envelope.deleteMany({ where: { budgetId: { in: budgetIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: session.workspaceId } });
    await prisma.budget.deleteMany({ where: { id: { in: budgetIds } } });
    await prisma.workspace.deleteMany({ where: { id: session.workspaceId } });
    await prisma.session.deleteMany({ where: { userId: session.userId } });
    await prisma.user.deleteMany({ where: { id: session.userId } });
  }
});
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm infra:up && pnpm db:migrate:dev && pnpm --filter @harmofin/api test:integration -- envelope-reallocations.integration.test.ts`
Expected: PASS (all `it` blocks). If `envelopeType: 'CUSTOM'` envelopes reject `periodSlot`-only fields, no change is needed — `createEnvelope` here never sets `periodSlot`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/envelope-reallocations.integration.test.ts
git commit -m "test(api): cover envelope reallocation API end to end"
```

---

### Task 6: Dashboard period-limit projection includes reallocations

**Files:**
- Modify: `apps/api/src/dashboard/dashboard.repository.ts`

**Interfaces:**
- Produces: `periodEnvelopeSummary`'s `reallocatedMinor` (and the opening balance it folds into) now also reflects confirmed `EnvelopeReallocation` rows into/out of the period envelope. No signature change — verified by Task 7's integration test.

- [ ] **Step 1: Extend the opening-balance term**

Edit `apps/api/src/dashboard/dashboard.repository.ts`, inside `periodEnvelopeSummary`'s `openingMinor` expression, immediately after the existing `transfer_parts` destination-envelope block that ends `AND transfer."occurred_on" < ${periodStart}::date ), 0)` (the block ending the line before `)::BIGINT AS "openingMinor",`):

```ts
        + COALESCE((
          SELECT SUM(reallocation."amount_minor")
          FROM "envelope_reallocations" AS reallocation
          WHERE reallocation."budget_id" = ${budgetId}::uuid
            AND reallocation."destination_envelope_id" = ${envelopeId}::uuid
            AND reallocation."status" = 'CONFIRMED'
            AND reallocation."occurred_on" < ${periodStart}::date
        ), 0)
        - COALESCE((
          SELECT SUM(reallocation."amount_minor")
          FROM "envelope_reallocations" AS reallocation
          WHERE reallocation."budget_id" = ${budgetId}::uuid
            AND reallocation."source_envelope_id" = ${envelopeId}::uuid
            AND reallocation."status" = 'CONFIRMED'
            AND reallocation."occurred_on" < ${periodStart}::date
        ), 0)
```

- [ ] **Step 2: Extend the in-period `reallocatedMinor` term**

In the same function, immediately after the existing transfer-parts `reallocatedMinor` block ends (right before `)::BIGINT AS "reallocatedMinor",`), add:

```ts
        + COALESCE((
          SELECT SUM(reallocation."amount_minor")
          FROM "envelope_reallocations" AS reallocation
          WHERE reallocation."budget_id" = ${budgetId}::uuid
            AND reallocation."destination_envelope_id" = ${envelopeId}::uuid
            AND reallocation."status" = 'CONFIRMED'
            AND reallocation."occurred_on" >= ${periodStart}::date
            AND reallocation."occurred_on" <= ${asOf}::date
        ), 0)
        - COALESCE((
          SELECT SUM(reallocation."amount_minor")
          FROM "envelope_reallocations" AS reallocation
          WHERE reallocation."budget_id" = ${budgetId}::uuid
            AND reallocation."source_envelope_id" = ${envelopeId}::uuid
            AND reallocation."status" = 'CONFIRMED'
            AND reallocation."occurred_on" >= ${periodStart}::date
            AND reallocation."occurred_on" <= ${asOf}::date
        ), 0)
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @harmofin/api typecheck`
Expected: no errors (this is a raw SQL template literal; correctness is proven by Task 7's integration test).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/dashboard/dashboard.repository.ts
git commit -m "feat(api): include envelope reallocations in the period limit projection"
```

---

### Task 7: Dashboard previous-period-leftover detection

**Files:**
- Modify: `apps/api/src/dashboard/dashboard.repository.ts`
- Modify: `apps/api/src/dashboard/dashboard.application.service.ts`
- Modify: `apps/api/src/dashboard/dashboard.application.service.test.ts`

**Interfaces:**
- Produces: `DashboardSummaryRecord.previousPeriodLeftover: { envelopeId: string; envelopeName: string; balanceMinor: bigint; currentPeriodEnvelopeId: string; currentPeriodEnvelopeName: string } | null` and `DashboardSummary.previousPeriodLeftover: { envelopeId: string; envelopeName: string; balanceMinor: string; currentPeriodEnvelopeId: string; currentPeriodEnvelopeName: string } | null`. Consumed by Task 8 (web DTO) and Task 9 (component).

- [ ] **Step 1: Write the failing unit tests**

Edit `apps/api/src/dashboard/dashboard.application.service.test.ts`. Add `previousPeriodLeftover: null,` to every existing mocked `summary.mockResolvedValue({...})` object in the file (six call sites) so the fixtures stay valid once the field is required. Then add two new tests at the end of the `describe` block, before the closing `});`:

```ts
  it('surfaces a previous-period leftover that is worth moving', async () => {
    const repository = {
      findAccessible: vi.fn().mockResolvedValue({
        id: budgetId,
        cycleStartDay: 10,
        periodBoundaryOffset: 15,
        timezone: 'Europe/Moscow',
        allowNegativeBalance: false,
      }),
      summary: vi.fn().mockResolvedValue({
        totalAccountMoneyMinor: 0n,
        accounts: [],
        envelopes: [],
        unallocatedIncomeMinor: 0n,
        unassignedStartingBalanceMinor: 0n,
        periodEnvelope: null,
        previousPeriodLeftover: {
          envelopeId: 'previous-envelope-id',
          envelopeName: 'Текущие 10–24',
          balanceMinor: 3_500_00n,
          currentPeriodEnvelopeId: 'current-envelope-id',
          currentPeriodEnvelopeName: 'Текущие 25–9',
        },
        warnings: [],
        upcomingObligations: [],
        onboarding: {
          categoriesSeeded: false,
          hasAccounts: false,
          hasEnvelopeStartingBalances: false,
          hasAllocatedIncome: false,
        },
      }),
    };
    const service = new DashboardApplicationService(repository as never);

    await expect(service.summary(userId, budgetId, '2026-08-25')).resolves.toMatchObject({
      previousPeriodLeftover: {
        envelopeId: 'previous-envelope-id',
        envelopeName: 'Текущие 10–24',
        balanceMinor: '350000',
        currentPeriodEnvelopeId: 'current-envelope-id',
        currentPeriodEnvelopeName: 'Текущие 25–9',
      },
    });
  });

  it('hides a negative previous-period leftover unless the budget allows negative balances', async () => {
    const repositoryFor = (allowNegativeBalance: boolean) => ({
      findAccessible: vi.fn().mockResolvedValue({
        id: budgetId,
        cycleStartDay: 10,
        periodBoundaryOffset: 15,
        timezone: 'Europe/Moscow',
        allowNegativeBalance,
      }),
      summary: vi.fn().mockResolvedValue({
        totalAccountMoneyMinor: 0n,
        accounts: [],
        envelopes: [],
        unallocatedIncomeMinor: 0n,
        unassignedStartingBalanceMinor: 0n,
        periodEnvelope: null,
        previousPeriodLeftover: {
          envelopeId: 'previous-envelope-id',
          envelopeName: 'Текущие 10–24',
          balanceMinor: -1_000n,
          currentPeriodEnvelopeId: 'current-envelope-id',
          currentPeriodEnvelopeName: 'Текущие 25–9',
        },
        warnings: [],
        upcomingObligations: [],
        onboarding: {
          categoriesSeeded: false,
          hasAccounts: false,
          hasEnvelopeStartingBalances: false,
          hasAllocatedIncome: false,
        },
      }),
    });

    const hidden = new DashboardApplicationService(repositoryFor(false) as never);
    await expect(hidden.summary(userId, budgetId, '2026-08-25')).resolves.toMatchObject({
      previousPeriodLeftover: null,
    });

    const shown = new DashboardApplicationService(repositoryFor(true) as never);
    await expect(shown.summary(userId, budgetId, '2026-08-25')).resolves.toMatchObject({
      previousPeriodLeftover: { balanceMinor: '-1000' },
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @harmofin/api test -- dashboard.application.service.test.ts`
Expected: FAIL — `previousPeriodLeftover` is not part of the resolved value yet (and the six pre-existing fixtures are missing the field, which is harmless until the type requires it in Step 4).

- [ ] **Step 3: Detect the other-slot envelope in the repository**

Edit `apps/api/src/dashboard/dashboard.repository.ts`. Add `previousPeriodLeftover` to the `DashboardSummaryRecord` type, right after `periodEnvelope`:

```ts
  previousPeriodLeftover: {
    envelopeId: string;
    envelopeName: string;
    balanceMinor: bigint;
    currentPeriodEnvelopeId: string;
    currentPeriodEnvelopeName: string;
  } | null;
```

In `summary()`, add an `otherPeriodEnvelope` query to the `Promise.all` array, right after the existing `periodEnvelope` query:

```ts
        tx.envelope.findFirst({
          where: {
            budgetId,
            archivedAt: null,
            periodSlot: period.id === 'FIRST' ? 'SECOND' : 'FIRST',
            budget: activeBudgetWhere(userId, budgetId),
          },
          select: { id: true },
        }),
```

Update the destructuring assignment above it to include the new result in order:

```ts
      const [
        accounts,
        envelopes,
        periodEnvelope,
        otherPeriodEnvelope,
        unallocatedIncomeMinor,
        unassignedStartingBalanceMinor,
        onboarding,
        upcomingObligations,
      ] = await Promise.all([
```

After `const envelopeBalances = await Promise.all(...)` (right before `const periodValues = ...`), add:

```ts
      const envelopeBalanceById = new Map(envelopeBalances.map((envelope) => [envelope.id, envelope]));
      const previousPeriodEnvelope = otherPeriodEnvelope
        ? envelopeBalanceById.get(otherPeriodEnvelope.id) ?? null
        : null;
      const currentPeriodEnvelopeForLeftover = periodEnvelope
        ? envelopeBalanceById.get(periodEnvelope.id) ?? null
        : null;
```

In the returned object, add `previousPeriodLeftover` right after `periodEnvelope:`:

```ts
        previousPeriodLeftover:
          previousPeriodEnvelope && currentPeriodEnvelopeForLeftover
            ? {
                envelopeId: previousPeriodEnvelope.id,
                envelopeName: previousPeriodEnvelope.name,
                balanceMinor: previousPeriodEnvelope.balanceMinor,
                currentPeriodEnvelopeId: currentPeriodEnvelopeForLeftover.id,
                currentPeriodEnvelopeName: currentPeriodEnvelopeForLeftover.name,
              }
            : null,
```

Also add `allowNegativeBalance: true,` to the `select` block of `findAccessible()`:

```ts
      select: {
        id: true,
        cycleStartDay: true,
        periodBoundaryOffset: true,
        timezone: true,
        allowNegativeBalance: true,
      },
```

- [ ] **Step 4: Apply the "worth showing" rule in the application service**

Edit `apps/api/src/dashboard/dashboard.application.service.ts`. Add `previousPeriodLeftover` to the `DashboardSummary` type, right after `periodLimit`:

```ts
  previousPeriodLeftover: {
    envelopeId: string;
    envelopeName: string;
    balanceMinor: string;
    currentPeriodEnvelopeId: string;
    currentPeriodEnvelopeName: string;
  } | null;
```

In `summary()`, add `previousPeriodLeftover` to the returned object, right after `periodLimit,`:

```ts
      previousPeriodLeftover: previousPeriodLeftoverView(
        values.previousPeriodLeftover,
        budget.allowNegativeBalance,
      ),
```

Add the helper function next to `periodLimitView`:

```ts
function previousPeriodLeftoverView(
  value: {
    envelopeId: string;
    envelopeName: string;
    balanceMinor: bigint;
    currentPeriodEnvelopeId: string;
    currentPeriodEnvelopeName: string;
  } | null,
  allowNegativeBalance: boolean,
) {
  if (!value) return null;
  const worthShowing = value.balanceMinor > 0n || (allowNegativeBalance && value.balanceMinor < 0n);
  if (!worthShowing) return null;
  return {
    envelopeId: value.envelopeId,
    envelopeName: value.envelopeName,
    balanceMinor: formatMinorUnits(value.balanceMinor),
    currentPeriodEnvelopeId: value.currentPeriodEnvelopeId,
    currentPeriodEnvelopeName: value.currentPeriodEnvelopeName,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @harmofin/api test -- dashboard.application.service.test.ts`
Expected: PASS (all tests, including the six pre-existing ones now carrying `previousPeriodLeftover: null` in their fixtures).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/dashboard/dashboard.repository.ts apps/api/src/dashboard/dashboard.application.service.ts apps/api/src/dashboard/dashboard.application.service.test.ts
git commit -m "feat(api): detect a previous period's leftover envelope balance on the dashboard"
```

---

### Task 8: Dashboard integration coverage for the leftover and the reallocation's effect on the limit

**Files:**
- Modify: `apps/api/test/dashboard-summary.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–7 plus the existing `seedSummaryData` helper in this file.
- Produces: none (leaf verification task).

- [ ] **Step 1: Write the failing test**

Edit `apps/api/test/dashboard-summary.integration.test.ts`. Add a new `it` block after `'hides foreign budget summary'`:

```ts
  it('reports a previous-period leftover and reflects a reallocation in the period limit', async () => {
    const session = await register(`summary-leftover-${randomUUID()}@harmofin.test`);
    try {
      const budget = await prisma.budget.findUniqueOrThrow({ where: { id: session.budgetId } });
      const today = todayInTimezone(new Date(), budget.timezone);
      const period = cycleAndPeriodFor(budget, today).period;
      const otherSlot = period.id === 'FIRST' ? 'SECOND' : 'FIRST';
      const currentEnvelopeId = randomUUID();
      const previousEnvelopeId = randomUUID();

      await prisma.envelope.create({
        data: {
          id: currentEnvelopeId,
          budgetId: session.budgetId,
          name: 'Текущий период leftover',
          envelopeType: 'CURRENT_EXPENSES',
          periodSlot: period.id,
          startingBalanceMinor: 0n,
          displayOrder: 0,
        },
      });
      await prisma.envelope.create({
        data: {
          id: previousEnvelopeId,
          budgetId: session.budgetId,
          name: 'Прошлый период leftover',
          envelopeType: 'CURRENT_EXPENSES',
          periodSlot: otherSlot,
          startingBalanceMinor: 5_000n,
          displayOrder: 1,
        },
      });

      const before = await server.inject({
        method: 'GET',
        url: `/api/v1/budgets/${session.budgetId}/summary`,
        cookies: { harmofin_session: session.cookie },
      });
      expect(before.json()).toMatchObject({
        previousPeriodLeftover: {
          envelopeId: previousEnvelopeId,
          envelopeName: 'Прошлый период leftover',
          balanceMinor: '5000',
          currentPeriodEnvelopeId: currentEnvelopeId,
        },
        periodLimit: { state: 'available', limitMinor: '0' },
      });

      const csrf = (
        await server.inject({
          method: 'GET',
          url: '/api/v1/auth/csrf',
          cookies: { harmofin_session: session.cookie },
        })
      ).json<{ csrfToken: string }>();
      const reallocated = await server.inject({
        method: 'POST',
        url: `/api/v1/budgets/${session.budgetId}/envelope-reallocations`,
        headers: {
          origin,
          'x-csrf-token': csrf.csrfToken,
          'idempotency-key': 'summary-leftover-move',
        },
        cookies: { harmofin_session: session.cookie },
        payload: {
          sourceEnvelopeId: previousEnvelopeId,
          destinationEnvelopeId: currentEnvelopeId,
          amount: '50.00',
          occurredOn: today,
        },
      });
      expect(reallocated.statusCode).toBe(201);

      const after = await server.inject({
        method: 'GET',
        url: `/api/v1/budgets/${session.budgetId}/summary`,
        cookies: { harmofin_session: session.cookie },
      });
      expect(after.json()).toMatchObject({
        previousPeriodLeftover: null,
        periodLimit: { state: 'available', limitMinor: '5000' },
      });
    } finally {
      await cleanup(session);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm infra:up && pnpm --filter @harmofin/api test:integration -- dashboard-summary.integration.test.ts`
Expected: FAIL if Tasks 6–7 are not yet applied in the working tree; PASS once they are (this task assumes Tasks 6 and 7 are already committed, so run this after them to confirm — if run standalone for TDD purposes against a clean checkout of only Task 8, it fails with `previousPeriodLeftover` undefined and a 404 on the reallocation route).

- [ ] **Step 3: Extend cleanup for the new table**

In the same file's `cleanup()` function, add a line right after `await prisma.transferPart.deleteMany(...)`:

```ts
    await prisma.envelopeReallocation.deleteMany({ where: { budgetId: { in: budgetIds } } });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @harmofin/api test:integration -- dashboard-summary.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/dashboard-summary.integration.test.ts
git commit -m "test(api): cover the previous-period leftover prompt and its effect on the period limit"
```

---

### Task 9: Web API client — envelope reallocation DTOs and dashboard field

**Files:**
- Modify: `apps/web/app/composables/useBudgetReferenceData.ts`

**Interfaces:**
- Produces: `EnvelopeReallocationDto`, `CreateEnvelopeReallocationInput`, `BudgetReferenceDataApi.createEnvelopeReallocation(budgetId, input, idempotencyKey)`, and `DashboardSummaryDto.previousPeriodLeftover`. Consumed by Task 10 and Task 11.

- [ ] **Step 1: Add the DTO and input types**

Edit `apps/web/app/composables/useBudgetReferenceData.ts`. Add right after the `TransferListResult` interface (after line 398):

```ts
export type EnvelopeReallocationStatus = 'CONFIRMED' | 'DELETED';

export interface EnvelopeReallocationDto {
  id: string;
  budgetId: string;
  status: EnvelopeReallocationStatus;
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amountMinor: string;
  currency: 'RUB';
  scale: 2;
  occurredOn: string;
  comment: string | null;
  deletedAt: string | null;
  sourceEnvelopeCurrentBalanceMinor: string;
  destinationEnvelopeCurrentBalanceMinor: string;
}

export interface CreateEnvelopeReallocationInput {
  sourceEnvelopeId: string;
  destinationEnvelopeId: string;
  amount: string;
  occurredOn: string;
  comment?: string | null | undefined;
}
```

- [ ] **Step 2: Add `previousPeriodLeftover` to `DashboardSummaryDto`**

Edit the `DashboardSummaryDto` type (around line 559), adding right after `periodLimit`'s closing union:

```ts
  previousPeriodLeftover: {
    envelopeId: string;
    envelopeName: string;
    balanceMinor: string;
    currentPeriodEnvelopeId: string;
    currentPeriodEnvelopeName: string;
  } | null;
```

- [ ] **Step 3: Add the interface method**

In the `BudgetReferenceDataApi` interface, right after `deleteTransfer(...)`:

```ts
  createEnvelopeReallocation(
    budgetId: string,
    input: CreateEnvelopeReallocationInput,
    idempotencyKey: string,
  ): Promise<EnvelopeReallocationDto>;
```

- [ ] **Step 4: Implement the method**

Add the path helper next to `transferPath` (around line 810):

```ts
  function envelopeReallocationPath(budgetId: string) {
    return `${budgetPath(budgetId)}/envelope-reallocations`;
  }
```

Add the implementation right after `deleteTransfer: (...)` (around line 1072):

```ts
    createEnvelopeReallocation: (budgetId, input, idempotencyKey) =>
      api.request<EnvelopeReallocationDto>(envelopeReallocationPath(budgetId), {
        method: 'POST',
        headers: idempotent(idempotencyKey),
        body: JSON.stringify(input),
      }),
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @harmofin/web typecheck`
Expected: fails until `apps/web/app/pages/app/index.test.ts` supplies `previousPeriodLeftover` in its `summary` fixture — that is fixed in Task 11. For this task alone, confirm the new symbols compile by running:

Run: `pnpm --filter @harmofin/web exec vue-tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -i "envelope-reallocation\|EnvelopeReallocation" || true`
Expected: no output (no errors mentioning the new types themselves).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/composables/useBudgetReferenceData.ts
git commit -m "feat(web): add envelope reallocation client and dashboard leftover field"
```

---

### Task 10: `PeriodLeftoverPrompt.vue` component

**Files:**
- Create: `apps/web/app/components/dashboard/PeriodLeftoverPrompt.vue`
- Test: `apps/web/app/components/dashboard/PeriodLeftoverPrompt.test.ts`

**Interfaces:**
- Consumes: `UiButton` (`../ui/Button.vue`), `UiModal` (`../ui/Modal.vue`), `UiSelect` (`../ui/Select.vue`), `FinanceMoneyInput` (`../finance/FinanceMoneyInput.vue`), `FinanceMoney` (`../finance/FinanceMoney.vue`), `CreateEnvelopeReallocationInput`/`DashboardSummaryDto` types (Task 9).
- Produces: component `PeriodLeftoverPrompt` with props `leftover: DashboardSummaryDto['previousPeriodLeftover']`, `budgetId: string`, `envelopes: ReadonlyArray<{ id: string; name: string }>`, `createReallocation: (budgetId: string, input: CreateEnvelopeReallocationInput, idempotencyKey: string) => Promise<unknown>`; emits `reallocated: []`. Consumed by Task 11.

- [ ] **Step 1: Write the failing component tests**

Create `apps/web/app/components/dashboard/PeriodLeftoverPrompt.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import PeriodLeftoverPrompt from './PeriodLeftoverPrompt.vue';

const leftover = {
  envelopeId: 'previous-envelope-id',
  envelopeName: 'Текущие 10–24',
  balanceMinor: '350000',
  currentPeriodEnvelopeId: 'current-envelope-id',
  currentPeriodEnvelopeName: 'Текущие 25–9',
};

const envelopes = [
  { id: 'previous-envelope-id', name: 'Текущие 10–24' },
  { id: 'current-envelope-id', name: 'Текущие 25–9' },
  { id: 'savings-envelope-id', name: 'Отпуск' },
];

const normalize = (value: string): string => value.replace(/[  ]/g, ' ');

describe('PeriodLeftoverPrompt', () => {
  it('renders nothing without a leftover', () => {
    const wrapper = mount(PeriodLeftoverPrompt, {
      props: { leftover: null, budgetId: 'budget-id', envelopes, createReallocation: vi.fn() },
    });

    expect(wrapper.find('[data-testid="period-leftover-prompt"]').exists()).toBe(false);
  });

  it('names both envelopes and the leftover amount', () => {
    const wrapper = mount(PeriodLeftoverPrompt, {
      props: { leftover, budgetId: 'budget-id', envelopes, createReallocation: vi.fn() },
    });

    const text = normalize(wrapper.text());
    expect(text).toContain('Текущие 10–24');
    expect(text).toContain('Текущие 25–9');
    expect(text).toContain('3 500,00 ₽');
  });

  it('moves the whole leftover into the current period envelope on one click', async () => {
    const createReallocation = vi.fn().mockResolvedValue({ id: 'reallocation-id' });
    const wrapper = mount(PeriodLeftoverPrompt, {
      props: { leftover, budgetId: 'budget-id', envelopes, createReallocation },
    });

    await wrapper.get('[data-action="move-all"]').trigger('click');
    await flushPromises();

    expect(createReallocation).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({
        sourceEnvelopeId: 'previous-envelope-id',
        destinationEnvelopeId: 'current-envelope-id',
        amount: '3500.00',
      }),
      expect.any(String),
    );
    expect(wrapper.emitted('reallocated')).toHaveLength(1);
  });

  it('opens a picker to distribute into a different envelope', async () => {
    const createReallocation = vi.fn().mockResolvedValue({ id: 'reallocation-id' });
    const wrapper = mount(PeriodLeftoverPrompt, {
      props: { leftover, budgetId: 'budget-id', envelopes, createReallocation },
    });

    await wrapper.get('[data-action="open-picker"]').trigger('click');
    await wrapper.get('[name="destinationEnvelopeId"]').setValue('savings-envelope-id');
    await wrapper.get('[name="amount"]').setValue('1 000,00');
    await wrapper.get('[data-action="submit-picker"]').trigger('click');
    await flushPromises();

    expect(createReallocation).toHaveBeenCalledWith(
      'budget-id',
      expect.objectContaining({
        sourceEnvelopeId: 'previous-envelope-id',
        destinationEnvelopeId: 'savings-envelope-id',
        amount: '1000.00',
      }),
      expect.any(String),
    );
    expect(wrapper.emitted('reallocated')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @harmofin/web test -- PeriodLeftoverPrompt.test.ts`
Expected: FAIL — `./PeriodLeftoverPrompt.vue` does not exist yet.

- [ ] **Step 3: Write the component**

Create `apps/web/app/components/dashboard/PeriodLeftoverPrompt.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { Info } from '@lucide/vue';

import FinanceMoney from '../finance/FinanceMoney.vue';
import FinanceMoneyInput from '../finance/FinanceMoneyInput.vue';
import UiButton from '../ui/Button.vue';
import UiModal from '../ui/Modal.vue';
import UiSelect from '../ui/Select.vue';
import type {
  CreateEnvelopeReallocationInput,
  DashboardSummaryDto,
} from '../../composables/useBudgetReferenceData.js';

defineOptions({ name: 'PeriodLeftoverPrompt' });

type Leftover = DashboardSummaryDto['previousPeriodLeftover'];

const props = defineProps<{
  leftover: Leftover;
  budgetId: string;
  envelopes: ReadonlyArray<{ id: string; name: string }>;
  createReallocation: (
    budgetId: string,
    input: CreateEnvelopeReallocationInput,
    idempotencyKey: string,
  ) => Promise<unknown>;
}>();

const emit = defineEmits<{ reallocated: [] }>();

const pickerOpen = ref(false);
const pickerDestinationId = ref('');
const pickerAmount = ref('');
const pending = ref(false);
const error = ref('');

const destinationOptions = computed(() =>
  props.envelopes
    .filter((envelope) => envelope.id !== props.leftover?.envelopeId)
    .map((envelope) => ({ value: envelope.id, label: envelope.name })),
);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDecimal(value: string): string {
  return value.replaceAll(/(?:\s|\xA0)/g, '').replace(',', '.');
}

function minorToDecimal(value: string): string {
  const parsed = BigInt(value);
  const sign = parsed < 0n ? '-' : '';
  const digits = (parsed < 0n ? -parsed : parsed).toString().padStart(3, '0');
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

async function moveAll() {
  if (!props.leftover) return;
  pending.value = true;
  error.value = '';
  try {
    await props.createReallocation(
      props.budgetId,
      {
        sourceEnvelopeId: props.leftover.envelopeId,
        destinationEnvelopeId: props.leftover.currentPeriodEnvelopeId,
        amount: minorToDecimal(props.leftover.balanceMinor),
        occurredOn: today(),
      },
      crypto.randomUUID(),
    );
    emit('reallocated');
  } catch {
    error.value = 'Не удалось перенести остаток. Повторите попытку.';
  } finally {
    pending.value = false;
  }
}

function openPicker() {
  if (!props.leftover) return;
  pickerDestinationId.value = '';
  pickerAmount.value = minorToDecimal(props.leftover.balanceMinor);
  error.value = '';
  pickerOpen.value = true;
}

function closePicker() {
  pickerOpen.value = false;
}

async function submitPicker() {
  if (!props.leftover || !pickerDestinationId.value) return;
  pending.value = true;
  error.value = '';
  try {
    await props.createReallocation(
      props.budgetId,
      {
        sourceEnvelopeId: props.leftover.envelopeId,
        destinationEnvelopeId: pickerDestinationId.value,
        amount: normalizeDecimal(pickerAmount.value),
        occurredOn: today(),
      },
      crypto.randomUUID(),
    );
    pickerOpen.value = false;
    emit('reallocated');
  } catch {
    error.value = 'Не удалось распределить остаток. Повторите попытку.';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <section
    v-if="leftover"
    class="period-leftover-prompt"
    data-testid="period-leftover-prompt"
    aria-labelledby="period-leftover-prompt-title"
  >
    <Info class="period-leftover-prompt__icon" :size="20" aria-hidden="true" />
    <div class="period-leftover-prompt__body">
      <p id="period-leftover-prompt-title" class="period-leftover-prompt__text">
        У вас остались средства в конверте «{{ leftover.envelopeName }}» —
        <FinanceMoney :minor-units="leftover.balanceMinor" currency="RUB" :scale="2" />. Перенести
        их в «{{ leftover.currentPeriodEnvelopeName }}» или распределить в другой конверт?
      </p>
      <p v-if="error" role="alert" class="period-leftover-prompt__error">{{ error }}</p>
      <div class="period-leftover-prompt__actions">
        <UiButton data-action="move-all" :disabled="pending" @click="moveAll">
          Перенести остаток
        </UiButton>
        <UiButton data-action="open-picker" variant="tertiary" :disabled="pending" @click="openPicker">
          Распределить в другой конверт
        </UiButton>
      </div>
    </div>

    <UiModal :open="pickerOpen" title="Распределить остаток" @close="closePicker">
      <FinanceMoneyInput v-model="pickerAmount" name="amount" label="Сумма" />
      <UiSelect
        v-model="pickerDestinationId"
        name="destinationEnvelopeId"
        label="Конверт назначения"
        placeholder="Выберите конверт"
        :options="destinationOptions"
      />
      <template #footer>
        <UiButton variant="tertiary" :disabled="pending" @click="closePicker">Отмена</UiButton>
        <UiButton
          data-action="submit-picker"
          :disabled="pending || !pickerDestinationId"
          @click="submitPicker"
        >
          Распределить
        </UiButton>
      </template>
    </UiModal>
  </section>
</template>

<style scoped>
.period-leftover-prompt {
  display: flex;
  gap: var(--hf-space-3);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

.period-leftover-prompt__icon {
  flex-shrink: 0;
  color: var(--hf-color-status-info);
}

.period-leftover-prompt__body {
  display: grid;
  flex: 1;
  gap: var(--hf-space-3);
}

.period-leftover-prompt__text {
  margin: 0;
}

.period-leftover-prompt__error {
  margin: 0;
  color: var(--hf-color-text-danger);
}

.period-leftover-prompt__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
}
</style>
```

Check whether `UiModal.vue` already supports a `#footer` slot — read `apps/web/app/components/ui/Modal.vue` in full before this step. If it has no `#footer` slot, add one there (append `<div class="modal__footer"><slot name="footer" /></div>` right before the modal's closing `</div>` tags, with a `.modal__footer { display: flex; justify-content: flex-end; gap: var(--hf-space-2); padding-top: var(--hf-space-3); }` style rule) instead of inventing a different footer pattern in `PeriodLeftoverPrompt.vue`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @harmofin/web test -- PeriodLeftoverPrompt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/dashboard/PeriodLeftoverPrompt.vue apps/web/app/components/dashboard/PeriodLeftoverPrompt.test.ts apps/web/app/components/ui/Modal.vue
git commit -m "feat(web): add the period-leftover reallocation prompt"
```

---

### Task 11: Wire the prompt into the dashboard page

**Files:**
- Modify: `apps/web/app/pages/app/index.vue`
- Modify: `apps/web/app/pages/app/index.test.ts`

**Interfaces:**
- Consumes: `PeriodLeftoverPrompt` (Task 10), `api.createEnvelopeReallocation` (Task 9), `envelopeDetails` from `useOperationReferenceData()` (already imported on this page for `envelopeById`).

- [ ] **Step 1: Update the failing page test fixture**

Edit `apps/web/app/pages/app/index.test.ts`. Add `previousPeriodLeftover: null,` to the shared `summary` fixture object, right after `warnings: [],` (around line 63). Then add a new test after the existing ones that mounts the page with a populated `previousPeriodLeftover` and asserts the prompt renders — read the rest of the file first to match its existing mounting helper (`mount(DashboardPage, { global: { stubs: {...} } })`) exactly, then add:

```ts
it('shows the period leftover prompt when the summary reports one', async () => {
  api.getDashboardSummary.mockResolvedValue({
    ...summary,
    previousPeriodLeftover: {
      envelopeId: 'previous-envelope-id',
      envelopeName: 'Текущие 10–24',
      balanceMinor: '350000',
      currentPeriodEnvelopeId: 'envelope-id',
      currentPeriodEnvelopeName: 'Текущие 25–9',
    },
  });
  api.listTransactions.mockResolvedValue({ items: [], nextCursor: null });
  api.getAccountsSummary.mockResolvedValue({ totalMinor: '0' });
  api.getEnvelopesSummary.mockResolvedValue({ totalMinor: '0' });

  const wrapper = mountDashboardPage();
  await flushPromises();

  expect(wrapper.find('[data-testid="period-leftover-prompt"]').exists()).toBe(true);
});
```

(If the file has no single `mountDashboardPage()` helper, use whichever mount call the surrounding tests already use instead of inventing a new helper name.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @harmofin/web test -- index.test.ts`
Expected: FAIL — the prompt is not rendered yet, and the pre-existing tests fail typecheck-adjacent lint on the fixture shape until Step 3 lands (the JS test itself still runs, since `summary` is a plain object, not a type-checked literal — the new field is simply ignored by earlier tests, so only the new test fails).

- [ ] **Step 3: Wire the component into the page**

Edit `apps/web/app/pages/app/index.vue`. Add the import next to `DashboardWarnings`:

```ts
import PeriodLeftoverPrompt from '../../components/dashboard/PeriodLeftoverPrompt.vue';
```

In the template, add the component right after `<DashboardWarnings ... />` and before `<div class="dashboard-hero-row">`:

```html
        <PeriodLeftoverPrompt
          :leftover="summary.previousPeriodLeftover"
          :budget-id="activeBudget.id"
          :envelopes="envelopeDetails"
          :create-reallocation="api.createEnvelopeReallocation"
          @reallocated="loadDashboard"
        />
```

`envelopeDetails` is already destructured from `useOperationReferenceData()` at the top of the script (it has `{ id, name }` at minimum — confirm its shape before this step; if it lacks `name`, use `envelopes` instead, which is the `{ value, label }` reference-data list already used elsewhere on this page, and map it to `{ id: value, name: label }` in a small `computed`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @harmofin/web test -- index.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck and lint the web app**

Run: `pnpm --filter @harmofin/web typecheck && pnpm --filter @harmofin/web lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/pages/app/index.vue apps/web/app/pages/app/index.test.ts
git commit -m "feat(web): surface the period-leftover prompt on the dashboard"
```

---

### Task 12: Playwright end-to-end coverage

**Files:**
- Create: `e2e/period-leftover.spec.ts`

**Interfaces:**
- Consumes: `apiV1` from `./env`, the same `registerAndReachApp`/`initializeTemplate`-style helpers as `e2e/transfers.spec.ts` (duplicated locally per this codebase's existing per-file convention — every `*.spec.ts` file defines its own copies rather than importing from another spec file).

- [ ] **Step 1: Write the end-to-end test**

Create `e2e/period-leftover.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { apiV1 } from './env';

const password = 'e2e-password-10';

test('prompts to move a previous period leftover and lets the owner move it entirely', async ({
  page,
}) => {
  const { budgetId, cookie, csrfToken, previousEnvelopeId, currentEnvelopeName } =
    await registerAndSeedLeftover(page, 'move-all');

  await page.goto('/app');
  await waitForHydration(page);
  await expect(page.getByTestId('period-leftover-prompt')).toBeVisible();
  await expect(page.getByTestId('period-leftover-prompt')).toContainText('5 000,00');
  await expect(page.getByTestId('period-leftover-prompt')).toContainText(currentEnvelopeName);

  await page.getByRole('button', { name: 'Перенести остаток' }).click();
  await expect(page.getByTestId('period-leftover-prompt')).toBeHidden();

  const balance = await page.evaluate(
    async ({ api, budgetId, envelopeId, cookie }) => {
      const response = await fetch(`${api}/budgets/${budgetId}/envelopes/${envelopeId}`, {
        credentials: 'include',
        headers: { Cookie: cookie },
      });
      return (await response.json()) as { currentBalanceMinor: string };
    },
    { api: apiV1, budgetId, envelopeId: previousEnvelopeId, cookie: `harmofin_session=${cookie}` },
  );
  expect(balance.currentBalanceMinor).toBe('0');
  void csrfToken;
});

test('lets the owner distribute part of a previous period leftover into a chosen envelope', async ({
  page,
}) => {
  await registerAndSeedLeftover(page, 'distribute');

  await page.goto('/app/envelopes');
  await waitForHydration(page);
  await page.getByRole('button', { name: 'Создать конверт' }).first().click();
  await page.getByLabel('Название конверта').fill('Отпуск distribute');
  await page.getByLabel('Начальный баланс').fill('0,00');
  await page.getByRole('button', { name: 'Сохранить конверт' }).click();
  await expect(page.getByText('Отпуск distribute')).toBeVisible();

  await page.goto('/app');
  await waitForHydration(page);
  await expect(page.getByTestId('period-leftover-prompt')).toBeVisible();
  await page.getByRole('button', { name: 'Распределить в другой конверт' }).click();
  await page.getByLabel('Конверт назначения').selectOption({ label: 'Отпуск distribute' });
  await page.getByLabel('Сумма').fill('20,00');
  await page.getByRole('button', { name: 'Распределить' }).click();

  await expect(page.getByTestId('period-leftover-prompt')).toContainText('4 980,00');
});

async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
}

async function registerAndSeedLeftover(page: Page, suffix: string) {
  const email = `period-leftover-${suffix}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}@harmofin.test`;
  await page.goto('/register');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/app$/);

  const session = await page.evaluate(async ({ api }) => {
    const csrf = (await fetch(`${api}/auth/csrf`, { credentials: 'include' }).then((response) =>
      response.json(),
    )) as { csrfToken: string };
    return csrf;
  }, { api: apiV1 });

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((item) => item.name === 'harmofin_session')?.value ?? '';

  const me = await page.evaluate(async ({ api }) => {
    const response = await fetch(`${api}/auth/me`, { credentials: 'include' });
    return (await response.json()) as { workspaces: Array<{ budgets: Array<{ id: string }> }> };
  }, { api: apiV1 });
  const budgetId = me.workspaces[0]?.budgets[0]?.id ?? '';

  // Today's period under the default cycle (start day 1, boundary offset 15):
  // days 1-14 are FIRST, days 15-end are SECOND. The "other" slot is always
  // the previous period once a boundary has been crossed.
  const dayOfMonth = new Date().getUTCDate();
  const currentSlot = dayOfMonth < 15 ? 'FIRST' : 'SECOND';
  const previousSlot = currentSlot === 'FIRST' ? 'SECOND' : 'FIRST';
  const currentEnvelopeName = `Текущие ${suffix} ${currentSlot}`;
  const previousEnvelopeName = `Текущие ${suffix} ${previousSlot}`;

  const currentEnvelopeId = await createPeriodEnvelope(
    page,
    session.csrfToken,
    budgetId,
    currentEnvelopeName,
    currentSlot,
    '0.00',
  );
  const previousEnvelopeId = await createPeriodEnvelope(
    page,
    session.csrfToken,
    budgetId,
    previousEnvelopeName,
    previousSlot,
    '50.00',
  );

  return {
    budgetId,
    cookie: sessionCookie,
    csrfToken: session.csrfToken,
    currentEnvelopeId,
    previousEnvelopeId,
    currentEnvelopeName,
  };
}

async function createPeriodEnvelope(
  page: Page,
  csrfToken: string,
  budgetId: string,
  name: string,
  periodSlot: 'FIRST' | 'SECOND',
  startingBalance: string,
): Promise<string> {
  const created = await page.evaluate(
    async ({ api, csrfToken, budgetId, name, periodSlot, startingBalance }) => {
      const response = await fetch(`${api}/budgets/${budgetId}/envelopes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({
          name,
          envelopeType: 'CURRENT_EXPENSES',
          periodSlot,
          currency: 'RUB',
          startingBalance,
          displayOrder: periodSlot === 'FIRST' ? 0 : 1,
        }),
      });
      return (await response.json()) as { id: string };
    },
    { api: apiV1, csrfToken, budgetId, name, periodSlot, startingBalance },
  );
  return created.id;
}
```

- [ ] **Step 2: Run the end-to-end test**

Run: `pnpm infra:up && pnpm dev &` then, once the web and API are ready, `pnpm test:e2e -- period-leftover.spec.ts`
Expected: PASS (both tests). Stop the background `pnpm dev` process afterward.

- [ ] **Step 3: Commit**

```bash
git add e2e/period-leftover.spec.ts
git commit -m "test(e2e): cover the period-leftover reallocation prompt"
```

---

### Task 13: Final quality gate

**Files:** none (verification only).

- [ ] **Step 1: Full lint, typecheck and unit/integration suite**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`
Expected: all green.

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: succeeds for both `apps/api` and `apps/web`.

- [ ] **Step 3: Report**

Summarize which commands were run and their results; do not create a PR or push unless the user asks.

---

## Self-Review Notes

- **Spec coverage:** design doc's "Модель данных" → Task 1; "Application services и API" → Tasks 2–5; "Детекция остатка на дашборде" → Tasks 6–8 (including the `periodEnvelopeSummary` extension the design doc implied under "Persistence и projections" but did not spell out — added explicitly here since without it the transferred money would not appear in the "Можно потратить" widget, defeating the feature's purpose); "Web UI" → Tasks 9–11; "Тесты и acceptance" → Tasks 1, 3, 5, 7, 8, 10, 12.
- **Design deviation, called out:** the design doc's recommended option mentioned `preDeleteStatus` for the new entity; this plan omits it because there is no restore endpoint in scope (matching `Transfer`, the closer analog, which also has no restore and no `preDeleteStatus` — only `IncomeAllocation`/`Transaction`, which *do* support restore, carry that column). The `AuditEvent.oldValues` written on delete already preserves the pre-delete state.
- **Placeholder scan:** no TBD/TODO markers; every step has literal code.
- **Type consistency:** `EnvelopeReallocationRecord`, `EnvelopeReallocationCreateData`, `EnvelopeReallocationView`, `EnvelopeReallocationDto`, and `CreateEnvelopeReallocationInput` use the same field names end to end (`sourceEnvelopeId`, `destinationEnvelopeId`, `amountMinor`/`amount`, `occurredOn`, `comment`) across Tasks 2, 3, 4, 5, 9 and 10.
