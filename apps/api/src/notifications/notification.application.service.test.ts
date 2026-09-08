import { describe, expect, it, vi } from 'vitest';

import { NotificationApplicationService } from './notification.application.service.js';

const userId = '00000000-0000-4000-8000-000000000001';
const budgetId = '00000000-0000-4000-8000-000000000002';

function notification() {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    budgetId,
    notificationType: 'PLAN_TODAY',
    occurrenceId: '00000000-0000-4000-8000-000000000004',
    relatedEntityType: null,
    relatedEntityId: null,
    title: 'Плановый платёж сегодня',
    body: 'Сегодня запланировано: «Платёж».',
    actionPath: '/app/plans?occurrence=00000000-0000-4000-8000-000000000004',
    readAt: null,
    resolvedAt: null,
    createdAt: new Date('2026-09-10T12:00:00.000Z'),
  };
}

describe('NotificationApplicationService', () => {
  it('returns only recipient-scoped notification fields', async () => {
    const repository = {
      findAccessibleBudget: vi.fn().mockResolvedValue({ id: budgetId }),
      list: vi.fn().mockResolvedValue({ items: [notification()], nextCursor: null }),
    };
    const service = new NotificationApplicationService(repository as never, {} as never);

    await expect(service.list(userId, budgetId, { state: 'all', limit: 25 })).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: notification().id,
          title: 'Плановый платёж сегодня',
          readAt: null,
        }),
      ],
      nextCursor: null,
    });
  });
});
