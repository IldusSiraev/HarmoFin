const byteOrderMark = String.fromCharCode(0xfeff);

export type CsvExportResult = {
  filename: string;
  content: string;
};

export type CsvCell = string | { value: string; escapeFormula: boolean };

export function encodeCsv(headers: string[], rows: CsvCell[][]): string {
  return `${byteOrderMark}${headers.map((header) => encodeCell(header, false)).join(';')}\r\n${rows
    .map((row) => row.map(encodeCsvCell).join(';'))
    .join('\r\n')}${rows.length > 0 ? '\r\n' : ''}`;
}

function encodeCsvCell(cell: CsvCell): string {
  return typeof cell === 'string'
    ? encodeCell(cell, true)
    : encodeCell(cell.value, cell.escapeFormula);
}

function encodeCell(value: string, escapeFormula: boolean): string {
  const safeValue = escapeFormula && /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safeValue) ? `"${safeValue.replaceAll('"', '""')}"` : safeValue;
}
