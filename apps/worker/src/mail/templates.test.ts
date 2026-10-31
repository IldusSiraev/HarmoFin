import { describe, expect, it } from 'vitest';

import { personLine, renderDigest, renderUrgent } from './templates.js';

const links = { webBaseUrl: 'https://app.example.test', unsubscribeToken: 'tok_123' };

describe('personLine', () => {
  it('lists non-empty groups in a fixed order with Russian plurals', () => {
    expect(
      personLine({ name: 'Анна', counts: { calendar: 1, operations: 3, envelopes: 2, family: 0 } }),
    ).toBe('Анна: 3 операции, 2 действия с конвертами, 1 событие календаря');
  });
});

describe('renderDigest', () => {
  const content = {
    frequency: 'DAILY' as const,
    periodLabel: '30 октября',
    people: [{ name: 'Анна <script>', counts: { operations: 1 } }],
    payments: [
      { name: 'Ипотека', amount: '45 000,00 ₽' },
      { name: 'Интернет', amount: null },
    ],
  };

  it('builds subject, text and escaped html with the feed link', () => {
    const mail = renderDigest(content, links);
    expect(mail.subject).toBe('HarmoFin: что нового в семье за 30 октября');
    expect(mail.text).toContain('Анна <script>: 1 операция');
    expect(mail.text).toContain('Ипотека — 45 000,00 ₽');
    expect(mail.text).toContain('Интернет');
    expect(mail.text).toContain('https://app.example.test/app/activity');
    expect(mail.html).toContain('Анна &lt;script&gt;');
    expect(mail.html).not.toContain('<script>');
  });

  it('uses the weekly subject', () => {
    expect(renderDigest({ ...content, frequency: 'WEEKLY' }, links).subject).toBe(
      'HarmoFin: что нового в семье за неделю',
    );
  });

  it('adds the settings and unsubscribe links and the List-Unsubscribe header only', () => {
    const mail = renderDigest(content, links);
    const unsubscribe = 'https://app.example.test/unsubscribe?token=tok_123';
    expect(mail.text).toContain('https://app.example.test/app/settings/notifications');
    expect(mail.text).toContain(unsubscribe);
    expect(mail.headers).toEqual({ 'List-Unsubscribe': `<${unsubscribe}>` });
  });
});

describe('renderUrgent', () => {
  it('links to the notification target', () => {
    const mail = renderUrgent(
      {
        subject: 'Просрочен платёж «Ипотека»',
        lines: ['План «Ипотека» просрочен с 2026-10-25.', 'Сумма по плану: 45 000,00 ₽.'],
        actionPath: '/app/plans?occurrence=occ-1',
      },
      links,
    );
    expect(mail.subject).toBe('Просрочен платёж «Ипотека»');
    expect(mail.text).toContain('План «Ипотека» просрочен с 2026-10-25.');
    expect(mail.text).toContain('Сумма по плану: 45 000,00 ₽.');
    expect(mail.text).toContain('https://app.example.test/app/plans?occurrence=occ-1');
    expect(mail.html).toContain('href="https://app.example.test/app/plans?occurrence=occ-1"');
  });
});
