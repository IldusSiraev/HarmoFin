import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { BudgetAccessPolicy, type AccessActor } from './budget-access.policy.js';

const policy = new BudgetAccessPolicy();
const ME = 'me';
const OTHER = 'other';

const creator: AccessActor = { userId: ME, role: 'OWNER', isCreator: true };
const editor: AccessActor = { userId: ME, role: 'EDITOR', isCreator: false };
const viewer: AccessActor = { userId: ME, role: 'VIEWER', isCreator: false };

const mine = { ownerUserId: ME };
const theirs = { ownerUserId: OTHER };
const myRecord = { createdByUserId: ME };
const theirRecord = { createdByUserId: OTHER };

function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    return ((error as ForbiddenException).getResponse() as { code: string }).code;
  }
}

describe('BudgetAccessPolicy matrix', () => {
  it('everyone reads', () => {
    expect([policy.canRead(creator), policy.canRead(editor), policy.canRead(viewer)]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it.each([
    ['canManageMembers', [true, false, false]],
    ['canManageBudgetSettings', [true, false, false]],
    ['canCreateObjects', [true, true, false]],
    ['canAllocateFree', [true, true, false]],
    ['canSpendFromEnvelope', [true, true, false]],
    ['canViewDeleted', [true, true, false]],
  ] as const)('%s by role (creator, editor, viewer)', (method, expected) => {
    expect([policy[method](creator), policy[method](editor), policy[method](viewer)]).toEqual(expected);
  });

  it('a non-creator OWNER row cannot manage members', () => {
    expect(policy.canManageMembers({ userId: ME, role: 'OWNER', isCreator: false })).toBe(false);
  });

  it.each([
    ['canEditObject'],
    ['canRecordOnAccount'],
    ['canMoveOutOfEnvelope'],
    ['canTransfer'],
  ] as const)('%s: only own object, never for viewer, creator has no override', (method) => {
    expect(policy[method](creator, mine)).toBe(true);
    expect(policy[method](creator, theirs)).toBe(false);
    expect(policy[method](editor, mine)).toBe(true);
    expect(policy[method](editor, theirs)).toBe(false);
    expect(policy[method](viewer, mine)).toBe(false);
  });

  it.each([['canEditTransaction'], ['canAllocateIncome']] as const)(
    '%s: only own record',
    (method) => {
      expect(policy[method](creator, myRecord)).toBe(true);
      expect(policy[method](creator, theirRecord)).toBe(false);
      expect(policy[method](editor, myRecord)).toBe(true);
      expect(policy[method](editor, theirRecord)).toBe(false);
      expect(policy[method](viewer, myRecord)).toBe(false);
    },
  );
});

describe('BudgetAccessPolicy require*', () => {
  it('viewer gets FORBIDDEN before any ownership code', () => {
    expect(codeOf(() => policy.requireWriter(viewer))).toBe('FORBIDDEN');
    expect(codeOf(() => policy.requireObjectOwner(viewer, mine))).toBe('FORBIDDEN');
    expect(codeOf(() => policy.requireAccountOwner(viewer, mine))).toBe('FORBIDDEN');
    expect(codeOf(() => policy.requireIncomeAuthor(viewer, myRecord))).toBe('FORBIDDEN');
    expect(codeOf(() => policy.requireOperationAuthor(viewer, myRecord))).toBe('FORBIDDEN');
    expect(codeOf(() => policy.requireCanViewDeleted(viewer))).toBe('FORBIDDEN');
  });

  it('writers get the ownership code for someone else’s object', () => {
    expect(codeOf(() => policy.requireObjectOwner(editor, theirs))).toBe('NOT_OBJECT_OWNER');
    expect(codeOf(() => policy.requireAccountOwner(creator, theirs))).toBe('NOT_ACCOUNT_OWNER');
    expect(codeOf(() => policy.requireIncomeAuthor(editor, theirRecord))).toBe('NOT_INCOME_AUTHOR');
    expect(codeOf(() => policy.requireOperationAuthor(creator, theirRecord))).toBe(
      'NOT_OPERATION_AUTHOR',
    );
  });

  it('passes for own objects and budget settings only for OWNER', () => {
    expect(codeOf(() => policy.requireObjectOwner(editor, mine))).toBeNull();
    expect(codeOf(() => policy.requireAccountOwner(editor, mine))).toBeNull();
    expect(codeOf(() => policy.requireIncomeAuthor(editor, myRecord))).toBeNull();
    expect(codeOf(() => policy.requireOperationAuthor(editor, myRecord))).toBeNull();
    expect(codeOf(() => policy.requireBudgetSettings(creator))).toBeNull();
    expect(codeOf(() => policy.requireBudgetSettings(editor))).toBe('FORBIDDEN');
  });
});
