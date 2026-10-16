import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('#imports', () => ({ definePageMeta: vi.fn() }));

import HelpPage from './help.vue';

describe('HelpPage', () => {
  it('explains the four numbers without physical envelope wallets', () => {
    const text = mount(HelpPage).text();

    expect(text).toContain('Как пользоваться HarmoFin');
    for (const term of ['На счетах', 'Отложено', 'Не распределено', 'Можно потратить']) {
      expect(text).toContain(term);
    }
    expect(text).not.toContain('Разбить перевод на несколько конвертов');
    expect(text).not.toContain(
      'Один счёт может одновременно содержать деньги нескольких конвертов',
    );
  });

  it('answers common questions in a details/summary list', () => {
    const wrapper = mount(HelpPage);

    expect(wrapper.findAll('summary').length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain('Меняет ли перевод между счетами распределение по конвертам?');
  });

  it('covers savings, overpayment, transfers, expected income, horizon, cycle and timezone', () => {
    const text = mount(HelpPage).text();

    expect(text).toContain('Садик');
    expect(text).toContain('3 000');
    expect(text).toContain('доплата');
    expect(text).toContain('Перевод между счетами не меняет распределение по конвертам');
    expect(text).toContain('Ожидаемый доход не входит в «На счетах»');
    expect(text).toContain('Учитываются ближайшие обязательные платежи');
    expect(text).toContain('будущего периода');
    expect(text).toContain('TIMEZONE_CHANGE_REQUIRES_RECONCILIATION');
  });
});
