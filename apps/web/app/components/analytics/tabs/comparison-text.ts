import type { PeriodComparisonV2Row } from '../../../composables/useEnvelopePlanV2.js';
import { formatMinorUnits } from '../../finance/money-format.js';

/** Sentence for the overview card; every number comes from the server row. */
export function comparisonText(row: PeriodComparisonV2Row): string {
  if (row.deltaBasisPoints === null) return 'В прошлом периоде к этому дню расходов не было.';
  if (row.deltaMinor === '0') return 'Столько же, сколько к этому дню прошлого периода.';
  const less = row.deltaMinor.startsWith('-');
  const amount = formatMinorUnits(less ? row.deltaMinor.slice(1) : row.deltaMinor, 'RUB', 2);
  const signed = `${less ? '−' : '+'}${amount}`;
  const percent = Math.trunc(Math.abs(row.deltaBasisPoints) / 100);
  const words = less ? 'меньше' : 'больше';
  const share = percent === 0 ? `${words} чем на 1%` : `на ${percent}% ${words}`;
  return `К этому дню прошлого периода: ${share} (${signed}).`;
}
