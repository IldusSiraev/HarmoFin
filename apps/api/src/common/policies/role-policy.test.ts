import { describe, expect, it } from 'vitest';

import { RolePolicy } from './role-policy.js';

describe('RolePolicy', () => {
  const policy = new RolePolicy();

  it.each(['OWNER', 'EDITOR', 'VIEWER'] as const)(
    'allows %s to read workspace and budget data',
    () => {
      expect(policy.canRead()).toBe(true);
    },
  );

  it('allows only OWNER to manage workspace, budget, and audit settings', () => {
    expect(policy.canManage('OWNER')).toBe(true);
    expect(policy.canManage('EDITOR')).toBe(false);
    expect(policy.canManage('VIEWER')).toBe(false);
  });
});
