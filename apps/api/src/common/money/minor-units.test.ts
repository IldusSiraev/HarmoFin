import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  ensureNonNegativeMinorUnits,
  formatMinorUnits,
  parseDecimalToMinorUnits,
} from './minor-units.js';

describe('parseDecimalToMinorUnits', () => {
  it.each([
    ['0', false, 0n],
    ['12', false, 1200n],
    ['12.3', false, 1230n],
    ['12.30', false, 1230n],
    ['-12.30', true, -1230n],
    ['+12.30', false, 1230n],
    ['92233720368547758.07', false, 9_223_372_036_854_775_807n],
    ['-92233720368547758.08', true, -9_223_372_036_854_775_808n],
  ])('parses %s without floating point', (input, allowNegative, expected) => {
    expect(parseDecimalToMinorUnits(input, 2, allowNegative)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    '12,30',
    '01.20',
    '1.234',
    '--1',
    '1e3',
    '92233720368547758.08',
    '-92233720368547758.09',
  ])('rejects invalid decimal %s', (input) => {
    expectValidationError(() => parseDecimalToMinorUnits(input, 2, true));
  });

  it('rejects a negative value when balance setting forbids it', () => {
    expectValidationError(() => parseDecimalToMinorUnits('-0.01', 2, false));
  });

  it('rejects negative planned and target values', () => {
    expectValidationError(() => ensureNonNegativeMinorUnits(-1n, 'targetAmount'));
  });

  it('formats canonical bigint strings', () => {
    expect(formatMinorUnits(-9_223_372_036_854_775_808n)).toBe('-9223372036854775808');
  });
});

function expectValidationError(action: () => unknown) {
  try {
    action();
    throw new Error('Expected a validation error.');
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  }
}
