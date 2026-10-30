import { describe, expect, it } from 'vitest';

import { participantsLabel } from './participants-label.js';

const alia = { userId: 'a', displayName: 'Алия', isActiveMember: true };
const ildar = { userId: 'i', displayName: 'Ильдар', isActiveMember: true };
const former = { userId: 'f', displayName: 'Тимур', isActiveMember: false };

describe('participantsLabel', () => {
  it('names people in order', () => {
    expect(participantsLabel([alia, ildar], new Set(['a', 'i', 't']))).toBe('Алия, Ильдар');
  });

  it('says "Вся семья" when every active member takes part', () => {
    expect(participantsLabel([ildar, alia], new Set(['a', 'i']))).toBe('Вся семья');
  });

  it('keeps former members with the existing caption', () => {
    expect(participantsLabel([alia, former], new Set(['a', 'i']))).toBe('Алия, Тимур (не в семье)');
  });

  it('is empty without participants', () => {
    expect(participantsLabel([], new Set(['a']))).toBe('');
  });
});
