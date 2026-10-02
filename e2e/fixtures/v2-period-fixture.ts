import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

// CI-only fixture for the v2 period scenarios. A real previous period cannot be
// reached in one test run (and no production endpoint may move time), so this
// writes ONE synthetic past EnvelopePeriod plus ONE OPENING assignment straight
// into the disposable CI database, and removes them again. Everything the user
// does afterwards goes through the UI/API.
//
// Previous boundaries are NOT recomputed from cycle settings here (the API's
// cycleAndPeriodFor is not importable from e2e). The dashboard already returns
// the current period start, and the server only needs endsOn < current start to
// treat a row as "previous period", so the synthetic row is the 14 days ending
// the day before the current start, on the same envelope as the current row.
// The DRAFT row of the current period is created by the pre-step of the dashboard
// GET (prepareCurrentPeriod), not by the template apply; callers read the
// dashboard first and pass its period.periodId.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const FORBIDDEN_PARAMS = ['host', 'hostaddr', 'service', 'options'];

// Refuses anything that is not a plain local database URL.
export function assertLocalDatabaseUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Period fixture refused: DATABASE_URL is not a valid URL.');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('Period fixture refused: DATABASE_URL is not a PostgreSQL URL.');
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('Period fixture refused: the database host is not localhost.');
  }
  for (const name of FORBIDDEN_PARAMS) {
    if (url.searchParams.has(name)) {
      throw new Error(`Period fixture refused: DATABASE_URL carries "${name}" override.`);
    }
  }
}

export interface PastLeftoverParams {
  budgetId: string;
  /** dashboard.period.periodId: the current period row of the main envelope. */
  currentPeriodId: string;
  /** dashboard.period.start (YYYY-MM-DD). */
  currentStart: string;
  /** Confirmation date: today in the budget's time zone (YYYY-MM-DD). */
  effectiveOn: string;
  /** Positive amount in minor units. */
  amountMinor: bigint;
  /** dashboard.freeToAssignMinor: cash must cover every positive assignment. */
  freeToAssignMinor: bigint;
}

export interface PastLeftover {
  envelopeId: string;
  periodId: string;
  cleanup: () => Promise<void>;
}

function shiftDays(isoDate: string, days: number): string {
  const moment = new Date(`${isoDate}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

const asDate = (isoDate: string): Date => new Date(`${isoDate}T00:00:00Z`);

export async function createPastLeftover(params: PastLeftoverParams): Promise<PastLeftover> {
  const url =
    process.env.DATABASE_URL ??
    'postgresql://harmofin_local:harmofin_local@localhost:5432/harmofin';
  assertLocalDatabaseUrl(url);
  if (params.amountMinor <= 0n) throw new Error('Leftover amount must be positive.');
  // cash >= sum of positive assignments, including this one.
  if (params.amountMinor > params.freeToAssignMinor) {
    throw new Error('Leftover would exceed the cash that backs the assignments.');
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const periodId = randomUUID();
  const assignmentId = randomUUID();
  try {
    const current = await prisma.envelopePeriod.findFirst({
      where: { id: params.currentPeriodId, budgetId: params.budgetId },
      select: { envelopeId: true },
    });
    if (!current) throw new Error('Current period row not found in this budget.');

    await prisma.$transaction(async (tx) => {
      await tx.envelopePeriod.create({
        data: {
          id: periodId,
          budgetId: params.budgetId,
          envelopeId: current.envelopeId,
          startsOn: asDate(shiftDays(params.currentStart, -14)),
          endsOn: asDate(shiftDays(params.currentStart, -1)),
          targetStatus: 'UNSET',
        },
      });
      await tx.envelopeAssignment.create({
        data: {
          id: assignmentId,
          budgetId: params.budgetId,
          envelopeId: current.envelopeId,
          type: 'OPENING',
          amountMinor: params.amountMinor,
          effectiveOn: asDate(params.effectiveOn),
          periodId,
          status: 'CONFIRMED',
        },
      });
    });

    return {
      envelopeId: current.envelopeId,
      periodId,
      cleanup: async () => {
        try {
          // Movements made from the leftover reference the period (Restrict).
          await prisma.$transaction([
            prisma.envelopeMovement.deleteMany({
              where: {
                budgetId: params.budgetId,
                OR: [{ sourcePeriodId: periodId }, { destinationPeriodId: periodId }],
              },
            }),
            prisma.envelopeAssignment.deleteMany({
              where: { budgetId: params.budgetId, periodId },
            }),
            prisma.envelopePeriod.deleteMany({
              where: { id: periodId, budgetId: params.budgetId },
            }),
          ]);
        } finally {
          await prisma.$disconnect();
        }
      },
    };
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}
