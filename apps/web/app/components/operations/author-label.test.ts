import { describe, expect, it } from 'vitest';

import { authorLabel } from './author-label.js';

describe('authorLabel', () => {
  it('shows the display name', () => {
    expect(authorLabel({ userId: 'u', displayName: 'Алия', isActiveMember: true })).toBe('Алия');
  });
  it('marks a former member with gender-neutral text', () => {
    expect(authorLabel({ userId: 'u', displayName: 'Алия', isActiveMember: false })).toBe(
      'Алия (не в семье)',
    );
  });
  it('falls back when the name is empty', () => {
    expect(authorLabel({ userId: 'u', displayName: null, isActiveMember: true })).toBe('Участник');
  });
});
