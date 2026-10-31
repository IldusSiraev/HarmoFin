import type { NotificationType, PrismaClient } from '@prisma/client';

import { formatMinor } from '../mail/format.js';
import type { UrgentContent } from '../mail/templates.js';
import type { ClaimedDelivery } from './delivery.repository.js';

type UrgentSource = {
  notificationType: NotificationType;
  title: string;
  body: string;
  actionPath: string | null;
  occurrence: { planName: string; amountMinor: bigint } | null;
  budget: { primaryCurrency: string };
};

/** Only the title, body and date the in-app notification already shows; the amount only with consent. */
export function urgentContentOf(source: UrgentSource, includeAmounts: boolean): UrgentContent | null {
  const actionPath = source.actionPath ?? '/app/notifications';
  if (source.notificationType === 'PLAN_OVERDUE') {
    const name = source.occurrence?.planName ?? source.title;
    const lines = [source.body];
    if (includeAmounts && source.occurrence) {
      lines.push(
        `Сумма по плану: ${formatMinor(source.occurrence.amountMinor, source.budget.primaryCurrency)}.`,
      );
    }
    return { subject: `Просрочен платёж «${name}»`, lines, actionPath };
  }
  if (source.notificationType === 'CALENDAR_REMINDER') {
    return { subject: `Напоминание: «${source.title}»`, lines: [source.body], actionPath };
  }
  return null;
}

export async function loadUrgentContent(
  prisma: PrismaClient,
  delivery: ClaimedDelivery,
  includeAmounts: boolean,
): Promise<UrgentContent | null> {
  if (!delivery.notificationId) return null;
  const source = await prisma.notification.findFirst({
    where: { id: delivery.notificationId, budgetId: delivery.budgetId, userId: delivery.userId },
    select: {
      notificationType: true,
      title: true,
      body: true,
      actionPath: true,
      occurrence: { select: { planName: true, amountMinor: true } },
      budget: { select: { primaryCurrency: true } },
    },
  });
  return source ? urgentContentOf(source, includeAmounts) : null;
}
