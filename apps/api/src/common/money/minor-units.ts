import { BadRequestException } from '@nestjs/common';

const BIGINT_MIN = -9_223_372_036_854_775_808n;
const BIGINT_MAX = 9_223_372_036_854_775_807n;
const DECIMAL_PATTERN = /^([+-]?)(0|[1-9]\d*)(?:\.(\d+))?$/;

export function parseDecimalToMinorUnits(
  value: string,
  scale: number,
  allowNegative: boolean,
): bigint {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) throw validationError('Некорректный денежный формат.');

  const [, sign, integerPart, fractionPart = ''] = match;
  if (fractionPart.length > scale) {
    throw validationError('Допустимо не более двух знаков после запятой.');
  }

  const digits = `${integerPart}${fractionPart.padEnd(scale, '0')}`;
  const parsed = BigInt(`${sign === '-' ? '-' : ''}${digits}`);
  if (!allowNegative && parsed < 0n) {
    throw validationError('Отрицательное денежное значение недопустимо.');
  }
  if (parsed < BIGINT_MIN || parsed > BIGINT_MAX) {
    throw validationError('Денежное значение выходит за допустимые пределы.');
  }

  return parsed;
}

export function formatMinorUnits(value: bigint): string {
  return value.toString();
}

export function ensureNonNegativeMinorUnits(value: bigint, field: string): void {
  if (value < 0n) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: 'Денежное значение не может быть отрицательным.',
      fieldErrors: [{ field, message: 'Значение не может быть отрицательным.', code: 'invalid' }],
    });
  }
}

function validationError(detail: string): BadRequestException {
  return new BadRequestException({ code: 'VALIDATION_FAILED', detail });
}
