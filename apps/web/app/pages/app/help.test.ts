import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const budgetRow: { planModelVersion?: 1 | 2 } = {};
const auth = { currentData: { value: { workspaces: [{ budgets: [budgetRow] }] } } };

vi.mock('#imports', () => ({ definePageMeta: vi.fn() }));
vi.mock('../../composables/useAuth.js', () => ({ useAuth: () => auth }));

import HelpPage from './help.vue';

describe('HelpPage', () => {
  beforeEach(() => {
    delete budgetRow.planModelVersion;
  });

  it('explains the core terms in plain language', () => {
    const wrapper = mount(HelpPage);
    const text = wrapper.text();

    expect(text).toContain('Как пользоваться HarmoFin');
    expect(text).toContain('Счёт');
    expect(text).toContain('Конверт');
    expect(text).toContain('Финансовый месяц');
    expect(text).toContain('Можно потратить');
  });

  it('answers common questions in a details/summary list', () => {
    const wrapper = mount(HelpPage);
    const summaries = wrapper.findAll('summary');

    expect(summaries.length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain('Чем счёт отличается от конверта?');
  });

  it('keeps the v1 text for model 1 budgets', () => {
    const text = mount(HelpPage).text();

    expect(text).not.toContain('Свободно для назначения');
  });

  describe('model v2', () => {
    beforeEach(() => {
      budgetRow.planModelVersion = 2;
    });

    it('explains the four numbers without physical envelope wallets', () => {
      const text = mount(HelpPage).text();

      for (const term of ['На счетах', 'Назначено', 'Свободно для назначения', 'Можно потратить']) {
        expect(text).toContain(term);
      }
      expect(text).not.toContain('Разбить перевод на несколько конвертов');
    });

    it('covers savings, overpayment, transfers, expected income, horizon, cycle and timezone', () => {
      const text = mount(HelpPage).text();

      expect(text).toContain('Садик');
      expect(text).toContain('3 000');
      expect(text).toContain('доплата');
      expect(text).toContain('Перевод между счетами не двигает назначения');
      expect(text).toContain('Ожидаемый доход не входит в «На счетах»');
      expect(text).toContain('горизонт');
      expect(text).toContain('будущего периода');
      expect(text).toContain('TIMEZONE_CHANGE_REQUIRES_RECONCILIATION');
    });
  });
});
