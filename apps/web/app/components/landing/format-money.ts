import { formatMinorUnits } from '../finance/money-format.js';

const MINOR_UNITS_IN_ROUBLE = 100n;

export function formatLandingMoney(minorUnits: string): string {
  if (!/^-?\d+$/.test(minorUnits)) {
    throw new TypeError('minorUnits must be an integer string');
  }

  const roubles = BigInt(minorUnits) / MINOR_UNITS_IN_ROUBLE;

  return formatMinorUnits(roubles.toString(), 'RUB', 0);
}

export function formatLandingSignedMoney(minorUnits: string, sign: 'plus' | 'minus'): string {
  const prefix = sign === 'plus' ? '+' : '−';

  return `${prefix}${formatLandingMoney(minorUnits)}`;
}
