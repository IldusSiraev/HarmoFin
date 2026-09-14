import type { AuditEventDto } from '../../composables/useBudgetReferenceData.js';

// Actions the API writes for a transaction: CREATED, UPDATED, RESTORED and the
// status the operation moved to.
const ACTION_LABELS: Record<string, string> = {
  CREATED: 'Создана',
  UPDATED: 'Изменена',
  CONFIRMED: 'Подтверждена',
  CANCELLED: 'Отменена',
  DELETED: 'Удалена',
  RESTORED: 'Восстановлена',
  DRAFT: 'Возвращена в черновик',
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function formatAuditMoment(iso: string, timeZone?: string): string {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return iso;
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(moment);
}

export function auditActorName(event: AuditEventDto): string {
  const actor = event.actor;
  if (actor === null) return 'Система';
  return actor.displayName ?? actor.email;
}
