import { escapeHtml } from '../mail/format.js';
import { personLine, type DigestContent, type UrgentContent } from '../mail/templates.js';
import type { TelegramButton, TelegramMessage } from './bot-api.js';

const FOOTER = 'Отключить: /stop или в настройках HarmoFin.';

/**
 * Telegram HTML: only <b> and escaped text. The content (and amounts, only with consent) comes from
 * the same loaders as email. Buttons only on an https web address: Telegram rejects other URLs.
 */
export function renderTelegramUrgent(content: UrgentContent, webBaseUrl: string): TelegramMessage {
  const text = [
    `<b>${escapeHtml(content.subject)}</b>`,
    ...content.lines.map(escapeHtml),
    '',
    FOOTER,
  ].join('\n');
  return { text, buttons: buttons(webBaseUrl, [['Открыть', content.actionPath]]) };
}

export function renderTelegramDigest(content: DigestContent, webBaseUrl: string): TelegramMessage {
  const title =
    content.frequency === 'WEEKLY'
      ? 'Что нового в семье за неделю'
      : `Что нового в семье за ${content.periodLabel}`;
  const lines = [`<b>${escapeHtml(title)}</b>`];
  if (content.people.length > 0) {
    lines.push('', ...content.people.map((person) => `• ${escapeHtml(personLine(person))}`));
  }
  if (content.payments.length > 0) {
    lines.push(
      '',
      '<b>Платежи сегодня</b>',
      ...content.payments.map(
        (payment) =>
          `• ${escapeHtml(payment.amount ? `${payment.name} — ${payment.amount}` : payment.name)}`,
      ),
    );
  }
  lines.push('', FOOTER);
  return {
    text: lines.join('\n'),
    buttons: buttons(webBaseUrl, [
      ['Открыть ленту', '/app/activity'],
      ['Настройки', '/app/settings/telegram'],
    ]),
  };
}

function buttons(
  webBaseUrl: string,
  items: ReadonlyArray<readonly [string, string]>,
): TelegramButton[] {
  const base = new URL(webBaseUrl);
  return items.flatMap(([text, path]) => {
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw new Error('Telegram link must be a path on the web origin');
    }
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw new Error('Telegram link leaves the web origin');
    return base.protocol === 'https:' ? [{ text, url: url.toString() }] : [];
  });
}
