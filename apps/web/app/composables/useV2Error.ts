import { ApiRequestError } from './useApiClient.js';

// One place that turns Envelope Plan v2.2 API errors into Russian text for the
// forms. Unknown codes fall back to the server detail only when it is not a
// bare technical message; field errors win for validation failures.
const MESSAGES: Record<string, string> = {
  MANDATORY_ENVELOPE_REQUIRED:
    'Обязательные расходы оплачиваются через разовый платёж или план, а не обычным расходом.',
  MANDATORY_PAYMENT_REQUIRED:
    'Обязательные расходы оплачиваются через разовый платёж или план, а не обычным расходом.',
  INSUFFICIENT_BALANCE: 'Недостаточно средств на счёте или в конверте.',
  IDEMPOTENCY_CONFLICT:
    'Этот запрос уже отправлялся с другими данными. Проверьте поля и повторите.',
  MODEL_VERSION_MISMATCH: 'Модель бюджета изменилась. Обновите страницу и повторите.',
  VALIDATION_FAILED: 'Проверьте введённые данные.',
};

export function v2ErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) return fallback;
  const mapped = MESSAGES[error.problem.code];
  if (mapped) return mapped;
  if (error.status === 422 || error.status === 400) return MESSAGES.VALIDATION_FAILED!;
  return fallback;
}
