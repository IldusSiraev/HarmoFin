import { describe, expect, it } from 'vitest';

import { auditActorName, auditActionLabel, formatAuditMoment } from './audit-event.js';
import type { AuditEventDto } from '../../composables/useBudgetReferenceData.js';

const event = (overrides: Partial<AuditEventDto> = {}): AuditEventDto =>
  ({
    id: 'audit-id',
    createdAt: '2026-09-14T10:28:07.826Z',
    actor: { id: 'user-id', displayName: null, email: 'owner@harmofin.test' },
    entityType: 'transaction',
    entityId: 'transaction-id',
    action: 'CREATED',
    source: 'API',
    oldValues: null,
    newValues: null,
    ...overrides,
  }) as AuditEventDto;

describe('audit event formatting', () => {
  it('names every action the transaction repository writes', () => {
    expect(auditActionLabel('CREATED')).toBe('Создана');
    expect(auditActionLabel('UPDATED')).toBe('Изменена');
    expect(auditActionLabel('CONFIRMED')).toBe('Подтверждена');
    expect(auditActionLabel('CANCELLED')).toBe('Отменена');
    expect(auditActionLabel('DELETED')).toBe('Удалена');
    expect(auditActionLabel('RESTORED')).toBe('Восстановлена');
    expect(auditActionLabel('DRAFT')).toBe('Возвращена в черновик');
  });

  it('falls back to the raw action it does not know', () => {
    expect(auditActionLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('writes the moment in the reader timezone', () => {
    expect(formatAuditMoment('2026-09-14T10:28:07.826Z', 'Europe/Moscow')).toBe(
      '14.09.2026, 13:28',
    );
  });

  it('prefers a display name, falls back to email, then to the system', () => {
    expect(
      auditActorName(event({ actor: { id: 'u', displayName: 'Ильдус', email: 'a@b.test' } })),
    ).toBe('Ильдус');
    expect(auditActorName(event())).toBe('owner@harmofin.test');
    expect(auditActorName(event({ actor: null }))).toBe('Система');
  });
});
