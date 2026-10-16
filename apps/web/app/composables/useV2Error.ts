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
  PERIOD_TARGET_NOT_DRAFT: 'Лимит на период уже изменился. Обновите страницу.',
  PERIOD_TARGET_ALREADY_CONFIRMED: 'Лимит на период уже подтверждён. Обновите страницу.',
  ENVELOPE_HAS_BALANCE:
    'В конверте остались деньги. Сначала направьте остаток в свободные или в другой конверт.',
  MANDATORY_ENVELOPE_EXISTS:
    'Конверт обязательных платежей уже есть: в бюджете может быть только один активный конверт обязательных платежей.',
  ASSIGNMENT_UNBACKED:
    'Недостаточно свободных денег для распределения. Обновите данные и проверьте сумму.',
  SOURCE_EXHAUSTED: 'Эти деньги уже распределены. Обновите данные.',
  ASSIGNMENT_HAS_DEPENDENCIES:
    'Распределение нельзя изменить: на него уже опираются расходы или переносы.',
  ENVELOPE_ARCHIVED: 'Конверт в архиве. Выберите активный конверт.',
  FUNDING_RULE_TYPE_NOT_ALLOWED: 'Этот тип правила подходит только для конверта «Обязательные».',
  PREVIEW_STALE: 'Данные изменились после предпросмотра. Обновите последствия и проверьте их.',
  CYCLE_CHANGE_PENDING:
    'Предыдущая смена цикла ещё не вступила в силу. Дождитесь её начала и повторите.',
  CYCLE_SETTINGS_UNCHANGED: 'Эти границы цикла уже действуют. Измените день или смещение.',
  TIMEZONE_CHANGE_REQUIRES_RECONCILIATION:
    'Часовой пояс нельзя менять после подтверждённых операций: календарные даты пришлось бы перекладывать.',
  TRANSACTION_NOT_EDITABLE: 'Удалённую или отменённую операцию нельзя изменить.',
  TRANSACTION_ALREADY_DELETED: 'Операция уже удалена. Обновите журнал.',
  TRANSACTION_NOT_DELETED: 'Восстановить можно только удалённую операцию. Обновите журнал.',
  PERIOD_AMBIGUOUS: 'Для этой даты найдено несколько периодов конверта. Выберите другую дату.',
  RESOURCE_NOT_FOUND: 'Не найдено. Обновите страницу.',
  VALIDATION_FAILED: 'Проверьте введённые данные.',
};

// `overrides` lets one screen word a shared code for its own context (an income
// delete blocked by assignments is not the funding "source exhausted" case).
export function v2ErrorMessage(
  error: unknown,
  fallback: string,
  overrides: Record<string, string> = {},
): string {
  if (!(error instanceof ApiRequestError)) return fallback;
  const mapped = overrides[error.problem.code] ?? MESSAGES[error.problem.code];
  if (mapped) return mapped;
  if (error.status === 403) return 'Недостаточно прав для этого действия.';
  if (error.status === 422 || error.status === 400) return MESSAGES.VALIDATION_FAILED!;
  return fallback;
}
