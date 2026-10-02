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
  INSUFFICIENT_ENVELOPE_BALANCE:
    'Нельзя перенести больше доступного остатка. Обновите данные и проверьте сумму.',
  PERIOD_TARGET_NOT_DRAFT: 'План периода уже изменился. Обновите страницу.',
  PERIOD_TARGET_ALREADY_CONFIRMED: 'План периода уже подтверждён. Обновите страницу.',
  ENVELOPE_HAS_BALANCE:
    'В конверте остались деньги. Сначала направьте остаток в свободные или в другой конверт.',
  MANDATORY_ENVELOPE_EXISTS:
    'Обязательный конверт уже есть: в бюджете может быть только один активный обязательный конверт.',
  ASSIGNMENT_UNBACKED:
    'Недостаточно свободных денег для назначения. Обновите данные и проверьте сумму.',
  SOURCE_EXHAUSTED: 'Источник уже полностью назначен. Обновите данные.',
  ASSIGNMENT_HAS_DEPENDENCIES:
    'Назначение нельзя изменить: на него уже опираются расходы или переносы.',
  ENVELOPE_ARCHIVED: 'Конверт в архиве. Выберите активный конверт.',
  VALIDATION_FAILED: 'Проверьте введённые данные.',
};

export function v2ErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) return fallback;
  const mapped = MESSAGES[error.problem.code];
  if (mapped) return mapped;
  if (error.status === 403) return 'Недостаточно прав для этого действия.';
  if (error.status === 422 || error.status === 400) return MESSAGES.VALIDATION_FAILED!;
  return fallback;
}
