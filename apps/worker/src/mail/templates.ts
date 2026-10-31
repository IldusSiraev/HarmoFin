import { escapeHtml, pluralRu } from './format.js';
import type { MailMessage } from './mailer.js';

export type DigestGroup =
  'operations' | 'transfers' | 'envelopes' | 'plans' | 'calendar' | 'family';
export type DigestPerson = { name: string; counts: Partial<Record<DigestGroup, number>> };
export type DigestPayment = { name: string; amount: string | null };
export type DigestContent = {
  frequency: 'DAILY' | 'WEEKLY';
  periodLabel: string;
  people: DigestPerson[];
  payments: DigestPayment[];
};
export type UrgentContent = { subject: string; lines: string[]; actionPath: string };
export type MailLinks = { webBaseUrl: string; unsubscribeToken: string };
export type RenderedMail = Omit<MailMessage, 'to'>;

const GROUP_ORDER: readonly DigestGroup[] = [
  'operations',
  'transfers',
  'envelopes',
  'plans',
  'calendar',
  'family',
];

const GROUP_FORMS: Record<DigestGroup, readonly [string, string, string]> = {
  operations: ['операция', 'операции', 'операций'],
  transfers: ['перевод', 'перевода', 'переводов'],
  envelopes: ['действие с конвертами', 'действия с конвертами', 'действий с конвертами'],
  plans: ['действие с планами', 'действия с планами', 'действий с планами'],
  calendar: ['событие календаря', 'события календаря', 'событий календаря'],
  family: ['изменение в семье', 'изменения в семье', 'изменений в семье'],
};

// Calm Fintech light palette (apps/web/app/assets/styles/tokens.css), inlined: mail clients drop
// <style> blocks and CSS variables.
const COLOR = {
  text: '#0d1b2a',
  muted: '#5b6b78',
  primary: '#2c5b8a',
  soft: '#e8eef3',
  surface: '#ffffff',
  border: '#e6e8eb',
};

type Section = { heading: string | null; items: string[] };

export function personLine(person: DigestPerson): string {
  const parts = GROUP_ORDER.filter((group) => (person.counts[group] ?? 0) > 0).map((group) => {
    const count = person.counts[group]!;
    const [one, few, many] = GROUP_FORMS[group];
    return `${count} ${pluralRu(count, one, few, many)}`;
  });
  return `${person.name}: ${parts.join(', ')}`;
}

export function renderDigest(content: DigestContent, links: MailLinks): RenderedMail {
  const weekly = content.frequency === 'WEEKLY';
  const sections: Section[] = [];
  if (content.people.length > 0) {
    sections.push({ heading: 'Что сделали в семье', items: content.people.map(personLine) });
  }
  if (content.payments.length > 0) {
    sections.push({
      heading: 'Платежи сегодня',
      items: content.payments.map((payment) =>
        payment.amount ? `${payment.name} — ${payment.amount}` : payment.name,
      ),
    });
  }
  return compose({
    subject: weekly
      ? 'HarmoFin: что нового в семье за неделю'
      : `HarmoFin: что нового в семье за ${content.periodLabel}`,
    intro: weekly
      ? 'Что произошло в семейном бюджете за неделю.'
      : `Что произошло в семейном бюджете за ${content.periodLabel}.`,
    sections,
    action: { url: absolute('/app/activity', links), label: 'Открыть ленту' },
    links,
  });
}

export function renderUrgent(content: UrgentContent, links: MailLinks): RenderedMail {
  const [intro = '', ...rest] = content.lines;
  return compose({
    subject: content.subject,
    intro,
    sections: rest.length > 0 ? [{ heading: null, items: rest }] : [],
    action: { url: absolute(content.actionPath, links), label: 'Открыть' },
    links,
  });
}

function absolute(path: string, links: MailLinks): string {
  const base = new URL(links.webBaseUrl);
  if (!path.startsWith('/')) {
    throw new Error(`Mail link must be a path on the web origin: ${path.slice(0, 40)}`);
  }
  const url = new URL(path, base);
  if (url.origin !== base.origin) {
    throw new Error(`Mail link leaves the web origin: ${path.slice(0, 40)}`);
  }
  return url.toString();
}

function compose(mail: {
  subject: string;
  intro: string;
  sections: Section[];
  action: { url: string; label: string };
  links: MailLinks;
}): RenderedMail {
  const settingsUrl = absolute('/app/settings/notifications', mail.links);
  const unsubscribe = new URL('/unsubscribe', mail.links.webBaseUrl);
  unsubscribe.searchParams.set('token', mail.links.unsubscribeToken);
  const unsubscribeUrl = unsubscribe.toString();
  const why = 'Вы получили письмо, потому что включили уведомления на почту в HarmoFin.';

  const text = [
    mail.intro,
    ...mail.sections.flatMap((section) => [
      '',
      ...(section.heading ? [section.heading] : []),
      ...section.items.map((item) => `• ${item}`),
    ]),
    '',
    `${mail.action.label}: ${mail.action.url}`,
    '',
    '—',
    why,
    `Настроить уведомления: ${settingsUrl}`,
    `Отписаться: ${unsubscribeUrl}`,
  ].join('\n');

  const sectionsHtml = mail.sections
    .map(
      (section) =>
        `${section.heading ? `<h2 style="margin:24px 0 8px;font-size:16px;color:${COLOR.text};">${escapeHtml(section.heading)}</h2>` : ''}` +
        `<ul style="margin:0;padding-left:20px;color:${COLOR.text};">${section.items
          .map((item) => `<li style="margin:4px 0;">${escapeHtml(item)}</li>`)
          .join('')}</ul>`,
    )
    .join('');

  const html =
    `<!doctype html><html lang="ru"><body style="margin:0;padding:24px;background:${COLOR.soft};font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px;background:${COLOR.surface};border:1px solid ${COLOR.border};border-radius:12px;">` +
    `<p style="margin:0 0 4px;color:${COLOR.muted};font-size:13px;">HarmoFin</p>` +
    `<p style="margin:0;color:${COLOR.text};">${escapeHtml(mail.intro)}</p>` +
    sectionsHtml +
    `<p style="margin:24px 0 0;"><a href="${escapeHtml(mail.action.url)}" style="display:inline-block;padding:10px 18px;background:${COLOR.primary};color:#ffffff;border-radius:8px;text-decoration:none;">${escapeHtml(mail.action.label)}</a></p>` +
    `<p style="margin:24px 0 0;color:${COLOR.muted};font-size:13px;">${escapeHtml(why)}<br>` +
    `<a href="${escapeHtml(settingsUrl)}" style="color:${COLOR.primary};">Настроить уведомления</a> · ` +
    `<a href="${escapeHtml(unsubscribeUrl)}" style="color:${COLOR.primary};">Отписаться</a></p>` +
    `</div></body></html>`;

  return {
    subject: mail.subject,
    text,
    html,
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
  };
}
