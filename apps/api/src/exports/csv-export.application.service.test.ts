import { describe, expect, it } from 'vitest';

import { encodeCsv } from './csv-export.application.service.js';

const byteOrderMark = String.fromCharCode(0xfeff);

describe('encodeCsv', () => {
  it('writes BOM, Russian headers and formula-safe cells', () => {
    const csv = encodeCsv(
      ['ID', 'Дата', 'Комментарий'],
      [['transaction-id', '2026-09-10', '=SUM(A1:A2)']],
    );

    expect(csv).toBe(
      `${byteOrderMark}ID;Дата;Комментарий\r\n` + "transaction-id;2026-09-10;'=SUM(A1:A2)\r\n",
    );
  });

  it.each(['=SUM(A1:A2)', '+SUM(A1:A2)', '-42', '@cmd'])('prefixes formula cell %s', (value) => {
    expect(encodeCsv(['Значение'], [[value]])).toBe(`${byteOrderMark}Значение\r\n'${value}\r\n`);
  });

  it('quotes semicolons, quotes and newlines', () => {
    expect(encodeCsv(['Комментарий'], [['платёж; "тест"\r\nследующая строка']])).toBe(
      `${byteOrderMark}Комментарий\r\n"платёж; ""тест""\r\nследующая строка"\r\n`,
    );
  });

  it('keeps canonical minor amount unchanged', () => {
    expect(encodeCsv(['Сумма (коп.)'], [[{ value: '-42', escapeFormula: false }]])).toBe(
      `${byteOrderMark}Сумма (коп.)\r\n-42\r\n`,
    );
  });
});
