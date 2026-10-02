import { ApiRequestError } from '../../composables/useApiClient.js';

// The blob goes straight to the browser download; nothing is stored or logged.
export function saveBlob(blob: Blob, filename: string): void {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportErrorText(exception: unknown): string {
  if (exception instanceof ApiRequestError) {
    if (exception.problem.code === 'EXPORT_LIMIT_EXCEEDED') {
      return 'В файле больше 10 000 строк, выгрузка недоступна.';
    }
    if (exception.status === 403) return 'Экспорт доступен только владельцу бюджета.';
    if (exception.problem.code === 'MODEL_VERSION_MISMATCH') {
      return 'Этот бюджет работает по другой модели. Обновите страницу.';
    }
  }
  return 'Не удалось скачать CSV. Повторите попытку.';
}
