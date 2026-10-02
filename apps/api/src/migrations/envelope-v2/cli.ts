import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { PrismaClient } from '@prisma/client';

import { CUTOVER_APPLICATION_NAME, cutover, type CutoverParams } from './cutover.js';

export class CliUsageError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CliUsageError';
  }
}

export type CliArgs = {
  help: boolean;
  budgetId: string;
  approvalFile: string;
  apply: boolean;
  maintenanceAck: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USAGE = [
  'Usage: node dist/migrations/envelope-v2/cli.js --budget-id <uuid> --approval-file <private-path>',
  '       [--dry-run]            (default) validate only, no writes',
  '       [--apply --maintenance-ack]   switch the budget; web/API/worker must be stopped',
  'DATABASE_URL is read from the environment.',
].join('\n');

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    budgetId: '',
    approvalFile: '',
    apply: false,
    maintenanceAck: false,
  };
  let dryRunFlag = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') dryRunFlag = true;
    else if (arg === '--maintenance-ack') args.maintenanceAck = true;
    else if (arg === '--budget-id' || arg === '--approval-file') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--'))
        throw new CliUsageError('ARGUMENT_VALUE_MISSING');
      i += 1;
      if (arg === '--budget-id') args.budgetId = value;
      else args.approvalFile = value;
    } else throw new CliUsageError('UNKNOWN_ARGUMENT');
  }
  if (args.help) return args;
  if (!UUID.test(args.budgetId)) throw new CliUsageError('BUDGET_ID_INVALID');
  if (args.approvalFile === '') throw new CliUsageError('APPROVAL_FILE_REQUIRED');
  if (args.apply && dryRunFlag) throw new CliUsageError('APPLY_AND_DRY_RUN_CONFLICT');
  if (args.apply && !args.maintenanceAck) throw new CliUsageError('MAINTENANCE_ACK_REQUIRED');
  if (!args.apply && args.maintenanceAck) throw new CliUsageError('MAINTENANCE_ACK_WITHOUT_APPLY');
  return args;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function loadApproval(path: string, budgetId: string): Omit<CutoverParams, 'dryRun'> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new CliUsageError('APPROVAL_FILE_INVALID');
  }
  if (
    !isObject(raw) ||
    typeof raw.budgetId !== 'string' ||
    typeof raw.ownerId !== 'string' ||
    typeof raw.fingerprint !== 'string' ||
    !UUID.test(raw.ownerId) ||
    !Array.isArray(raw.assignments) ||
    !Array.isArray(raw.periodTargets) ||
    !Array.isArray(raw.fundingRules) ||
    ![...raw.assignments, ...raw.periodTargets, ...raw.fundingRules].every(isObject)
  ) {
    throw new CliUsageError('APPROVAL_FILE_INVALID');
  }
  if (raw.budgetId.toLowerCase() !== budgetId.toLowerCase()) {
    throw new CliUsageError('APPROVAL_BUDGET_MISMATCH');
  }
  return {
    budgetId,
    ownerId: raw.ownerId,
    approvedFingerprint: raw.fingerprint,
    approvedAssignments: raw.assignments as CutoverParams['approvedAssignments'],
    approvedPeriodTargets: raw.periodTargets as CutoverParams['approvedPeriodTargets'],
    approvedFundingRules: raw.fundingRules as CutoverParams['approvedFundingRules'],
  };
}

/** host:port/database only: no credentials, no query. */
export function describeTarget(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `${url.host}${url.pathname}`;
}

function withApplicationName(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('application_name', CUTOVER_APPLICATION_NAME);
  return url.toString();
}

function errorCode(error: unknown): string {
  if (error instanceof CliUsageError) return error.code;
  if (isObject(error)) {
    if (typeof error.code === 'string') return error.code;
    if (isObject(error.response) && typeof error.response.code === 'string') {
      return error.response.code;
    }
  }
  return 'CUTOVER_FAILED';
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const requestId = randomUUID();
  let prisma: PrismaClient | undefined;
  try {
    const args = parseArgs(argv);
    if (args.help) {
      console.log(USAGE);
      return 0;
    }
    const databaseUrl = env.DATABASE_URL;
    if (!databaseUrl) throw new CliUsageError('DATABASE_URL_REQUIRED');
    const approval = loadApproval(args.approvalFile, args.budgetId);
    console.log(`Target: ${describeTarget(databaseUrl)}`);
    console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
    if (!args.apply)
      console.log('Dry-run does not prove the maintenance freeze or the owner role.');
    prisma = new PrismaClient({ datasources: { db: { url: withApplicationName(databaseUrl) } } });
    const result = await cutover(prisma, { ...approval, dryRun: !args.apply }, { requestId });
    console.log(
      `OK modelVersion=${result.modelVersion} assignments=${result.assignmentCount} cashUnchanged=${
        result.beforeCash === result.afterCash
      }`,
    );
    return 0;
  } catch (error) {
    const blockers =
      isObject(error) && Array.isArray(error.blockers)
        ? ` blockers=${error.blockers.join(',')}`
        : '';
    console.error(`FAILED code=${errorCode(error)}${blockers} requestId=${requestId}`);
    return 1;
  } finally {
    await prisma?.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
