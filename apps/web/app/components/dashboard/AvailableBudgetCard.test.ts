import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AvailableBudgetCard from './AvailableBudgetCard.vue';

const period = { id: 'SECOND' as const, start: '2026-09-25', end: '2026-10-09' };

const available = {
  state: 'available' as const,
  envelopeId: 'envelope-id',
  limitMinor: '6300000',
  spentMinor: '4120000',
  remainingMinor: '2180000',
  daysUntilBoundary: 7,
  averageRemainingDailyLimitMinor: '311400',
};

const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ');

describe('AvailableBudgetCard', () => {
  it('leads with the amount the user can still spend', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { periodLimit: available, period } });
    const text = normalize(wrapper.text());

    expect(text).toContain('Можно потратить');
    expect(text).toContain('21 800,00 ₽');
    expect(text).toContain('до 9 октября');
    expect(text).toContain('осталось 7 дней');
    expect(text).toContain('Было доступно');
    expect(text).toContain('63 000,00 ₽');
    expect(text).toContain('В среднем в день');
    expect(text).toContain('3 114,00 ₽');
  });

  it('exposes spending progress to assistive technology', () => {
    const wrapper = mount(AvailableBudgetCard, { props: { periodLimit: available, period } });
    const bar = wrapper.get('[role="progressbar"]');

    expect(bar.attributes('aria-valuenow')).toBe('65');
    expect(bar.attributes('aria-valuemin')).toBe('0');
    expect(bar.attributes('aria-valuemax')).toBe('100');
    expect(normalize(bar.attributes('aria-label') ?? '')).toBe(
      'Потрачено 41 200,00 ₽ из лимита 63 000,00 ₽',
    );
  });

  it('names its state in words, not only in colour', () => {
    const warning = mount(AvailableBudgetCard, {
      props: {
        periodLimit: { ...available, spentMinor: '5100000', remainingMinor: '1200000' },
        period,
      },
    });
    expect(normalize(warning.text())).toContain('Лимит периода почти исчерпан');

    const critical = mount(AvailableBudgetCard, {
      props: {
        periodLimit: { ...available, spentMinor: '6100000', remainingMinor: '200000' },
        period,
      },
    });
    expect(normalize(critical.text())).toContain('Остатка хватит меньше чем на день');

    const negative = mount(AvailableBudgetCard, {
      props: {
        periodLimit: { ...available, spentMinor: '6500000', remainingMinor: '-200000' },
        period,
      },
    });
    expect(normalize(negative.text())).toContain('Лимит периода превышен');
  });

  it('explains an unconfigured period instead of showing a fake zero', () => {
    const wrapper = mount(AvailableBudgetCard, {
      props: { periodLimit: { state: 'unavailable' }, period },
    });

    expect(wrapper.text()).toContain('Конверт текущего периода не настроен');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
  });
});
