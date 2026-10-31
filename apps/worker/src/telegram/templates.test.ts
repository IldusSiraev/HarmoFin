import { describe, expect, it } from 'vitest';

import { renderTelegramDigest, renderTelegramUrgent } from './templates.js';

const https = 'https://harmofin.example';

describe('renderTelegramUrgent', () => {
  it('escapes HTML and links the action path', () => {
    const message = renderTelegramUrgent(
      {
        subject: 'Просрочен платёж «<Ипотека>»',
        lines: ['План «<Ипотека>» просрочен с 2026-10-25.'],
        actionPath: '/app/plans?occurrence=1',
      },
      https,
    );
    expect(message.text).toContain('<b>Просрочен платёж «&lt;Ипотека&gt;»</b>');
    expect(message.text).not.toContain('<Ипотека>');
    expect(message.text).toContain('/stop');
    expect(message.buttons).toEqual([
      { text: 'Открыть', url: 'https://harmofin.example/app/plans?occurrence=1' },
    ]);
  });

  it('has no buttons on a non-https web address', () => {
    const message = renderTelegramUrgent(
      { subject: 'Напоминание', lines: ['Сегодня'], actionPath: '/app/calendar' },
      'http://localhost:3000',
    );
    expect(message.buttons).toEqual([]);
  });

  it('refuses a link outside the web origin', () => {
    expect(() =>
      renderTelegramUrgent({ subject: 's', lines: [], actionPath: '//evil.example/x' }, https),
    ).toThrow();
  });
});

describe('renderTelegramDigest', () => {
  it('lists people and payments with feed and settings buttons', () => {
    const message = renderTelegramDigest(
      {
        frequency: 'DAILY',
        periodLabel: '2 ноября',
        people: [{ name: 'Анна & Ко', counts: { operations: 3, calendar: 1 } }],
        payments: [
          { name: 'Ипотека', amount: '45 000,00 ₽' },
          { name: 'Интернет', amount: null },
        ],
      },
      https,
    );
    expect(message.text).toContain('<b>Что нового в семье за 2 ноября</b>');
    expect(message.text).toContain('• Анна &amp; Ко: 3 операции, 1 событие календаря');
    expect(message.text).toContain('<b>Платежи сегодня</b>');
    expect(message.text).toContain('• Ипотека — 45 000,00 ₽');
    expect(message.text).toContain('• Интернет');
    expect(message.buttons.map((button) => button.text)).toEqual(['Открыть ленту', 'Настройки']);
    expect(message.buttons[1]!.url).toBe('https://harmofin.example/app/settings/telegram');
  });

  it('titles a weekly digest by the week', () => {
    const message = renderTelegramDigest(
      {
        frequency: 'WEEKLY',
        periodLabel: 'неделю',
        people: [],
        payments: [{ name: 'A', amount: null }],
      },
      https,
    );
    expect(message.text).toContain('<b>Что нового в семье за неделю</b>');
  });
});
