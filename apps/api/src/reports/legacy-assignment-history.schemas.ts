import { z } from 'zod';

export const legacyAssignmentSourceKinds = [
  'LEGACY_ALLOCATION',
  'LEGACY_ENVELOPE_START',
  'LEGACY_REALLOCATION',
] as const;
export type LegacyAssignmentSourceKind = (typeof legacyAssignmentSourceKinds)[number];

export const MAX_LEGACY_ASSIGNMENT_PAGE = 100;

export type LegacyAssignmentCursor = {
  budgetId: string;
  occurredOn: string;
  sourceKind: LegacyAssignmentSourceKind;
  id: string;
};

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cursorTuple = z.tuple([uuid, date, z.enum(legacyAssignmentSourceKinds), uuid]);

/** Opaque keyset cursor: it carries the budget it was issued for and the last row's sort key. */
export function encodeLegacyAssignmentCursor(cursor: LegacyAssignmentCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.budgetId, cursor.occurredOn, cursor.sourceKind, cursor.id]),
  ).toString('base64url');
}

function decodeCursor(value: string): LegacyAssignmentCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const parsed = cursorTuple.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString()));
    if (!parsed.success) return null;
    const [budgetId, occurredOn, sourceKind, id] = parsed.data;
    if (Number.isNaN(Date.parse(`${occurredOn}T00:00:00.000Z`))) return null;
    if (new Date(`${occurredOn}T00:00:00.000Z`).toISOString().slice(0, 10) !== occurredOn) {
      return null;
    }
    return { budgetId, occurredOn, sourceKind, id };
  } catch {
    return null;
  }
}

export const legacyAssignmentHistoryQuerySchema = z
  .object({
    cursor: z
      .string()
      .max(256)
      .transform((value, context) => {
        const decoded = decodeCursor(value);
        if (!decoded) {
          context.addIssue({ code: 'custom', message: 'Некорректный курсор.' });
          return z.NEVER;
        }
        return decoded;
      })
      .optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LEGACY_ASSIGNMENT_PAGE).default(50),
  })
  .strict();

export type LegacyAssignmentHistoryQuery = z.output<typeof legacyAssignmentHistoryQuerySchema>;
