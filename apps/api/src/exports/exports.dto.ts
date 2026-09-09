export const csvExportResponse = {
  description: 'CSV-файл операций в кодировке UTF-8.',
  content: {
    'text/csv': {
      schema: { type: 'string', format: 'binary' },
    },
  },
};
