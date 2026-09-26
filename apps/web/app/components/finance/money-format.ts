export function formatMinorUnits(
  minorUnits: string | bigint,
  currency: string,
  scale: number,
  locale = 'ru-RU',
): string {
  if (!/^-?\d+$/.test(String(minorUnits))) {
    throw new TypeError('minorUnits must be an integer string or bigint');
  }
  if (!Number.isSafeInteger(scale) || scale < 0) {
    throw new TypeError('scale must be a non-negative safe integer');
  }

  const value = typeof minorUnits === 'bigint' ? minorUnits : BigInt(minorUnits);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const integer = (magnitude / divisor).toString();
  const fraction = (magnitude % divisor).toString().padStart(scale, '0');
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
  const group = formatter.formatToParts(1000).find((part) => part.type === 'group')?.value ?? ' ';
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);

  return formatter
    .formatToParts(negative ? -0 : 0)
    .map((part) => {
      if (part.type === 'integer') return groupedInteger;
      if (part.type === 'fraction') return fraction;
      return part.value;
    })
    .join('');
}

export function formatCompactSigned(signedMinor: string, scale: number): string {
  if (!/^-?\d+$/.test(signedMinor)) {
    throw new TypeError('signedMinor must be an integer string');
  }
  if (!Number.isSafeInteger(scale) || scale < 0) {
    throw new TypeError('scale must be a non-negative safe integer');
  }

  const value = BigInt(signedMinor);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const whole = magnitude / divisor;
  const sign = negative ? '−' : '+';

  if (whole < 1000n) {
    return `${sign}${whole}`;
  }

  const thousands = (whole + 500n) / 1000n;
  return `${sign}${thousands}к`;
}
