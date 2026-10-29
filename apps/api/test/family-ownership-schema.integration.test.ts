import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

afterAll(async () => {
  await prisma.$disconnect();
});

async function columnInfo(table: string, column: string) {
  const rows = await prisma.$queryRaw<Array<{ is_nullable: string; data_type: string }>>`
    SELECT is_nullable, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `;
  return rows[0];
}

describe('family object ownership schema', () => {
  it.each([
    ['accounts', 'owner_user_id'],
    ['envelopes', 'owner_user_id'],
    ['regular_plans', 'owner_user_id'],
    ['envelope_assignments', 'created_by_user_id'],
    ['envelope_movements', 'created_by_user_id'],
  ])('%s.%s is a NOT NULL uuid', async (table, column) => {
    expect(await columnInfo(table, column)).toEqual({ is_nullable: 'NO', data_type: 'uuid' });
  });

  it.each([
    ['accounts', 'accounts_owner_user_id_fkey'],
    ['envelopes', 'envelopes_owner_user_id_fkey'],
    ['regular_plans', 'regular_plans_owner_user_id_fkey'],
    ['envelope_assignments', 'envelope_assignments_created_by_user_id_fkey'],
    ['envelope_movements', 'envelope_movements_created_by_user_id_fkey'],
  ])('%s has foreign key %s to users', async (table, constraint) => {
    const rows = await prisma.$queryRaw<Array<{ target: string }>>`
      SELECT ccu.table_name AS target
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = ${table} AND tc.constraint_name = ${constraint}
        AND tc.constraint_type = 'FOREIGN KEY'
    `;
    expect(rows).toEqual([{ target: 'users' }]);
  });

  it.each([
    'accounts_budget_id_owner_user_id_idx',
    'envelopes_budget_id_owner_user_id_idx',
    'regular_plans_budget_id_owner_user_id_idx',
  ])('index %s exists', async (index) => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${index}
    `;
    expect(rows).toHaveLength(1);
  });

  it('rejects an account without an owner', async () => {
    // Prisma's raw-query error surfaces the PostgreSQL error DETAIL (not MESSAGE) in
    // `.message`/`.meta.message`; the PostgreSQL SQLSTATE for a NOT NULL violation
    // (verified directly against the database) is the reliable signal here.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "accounts" ("id", "budget_id", "name", "account_type", "starting_balance_minor",
           "accounting_start_date", "updated_at")
         VALUES ('${randomUUID()}', '${randomUUID()}', 'x', 'CASH', 0, '2026-01-01', now())`,
      ),
    ).rejects.toMatchObject({ meta: { code: '23502' } });
  });

  it('knows the OBJECTS_TRANSFERRED notification type', async () => {
    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT unnest(enum_range(NULL::"NotificationType"))::text AS value
    `;
    expect(rows.map((row) => row.value)).toContain('OBJECTS_TRANSFERRED');
  });
});
