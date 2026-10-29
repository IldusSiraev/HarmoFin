import { describe, expect, it } from 'vitest';

import { ownerLabel, ownerNotice } from './owner-label.js';

const alia = { userId: 'u-alia', displayName: 'Алия', isActiveMember: true };

describe('ownerLabel', () => {
  it('names the current user «Мой»', () => {
    expect(ownerLabel(alia, 'u-alia')).toBe('Мой');
  });

  it('names other members by name and marks former ones', () => {
    expect(ownerLabel(alia, 'u-me')).toBe('Алия');
    expect(ownerLabel({ ...alia, isActiveMember: false }, 'u-me')).toBe('Алия (не в семье)');
  });

  it('explains why a foreign object is read-only', () => {
    expect(ownerNotice(alia)).toBe('Принадлежит участнику «Алия» — изменять может только владелец');
  });
});
