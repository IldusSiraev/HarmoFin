import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PeriodLimitCard from './PeriodLimitCard.vue';

describe('PeriodLimitCard', () => {
  it('renders server-provided period values without calculating them', () => {
    const wrapper = mount(PeriodLimitCard, {
      props: {
        periodLimit: {
          state: 'available',
          envelopeId: 'envelope-id',
          limitMinor: '10000',
          spentMinor: '2500',
          remainingMinor: '7500',
          daysUntilBoundary: 7,
          averageRemainingDailyLimitMinor: '1071',
        },
      },
    });

    const text = wrapper.text().replaceAll(' ', ' ');
    expect(text).toContain('Лимит:100,00 ₽');
    expect(text).toContain('Остаток:75,00 ₽');
    expect(text).toContain('До следующей границы:7 дней');
  });

  it('explains unavailable period slot without inventing money value', () => {
    const wrapper = mount(PeriodLimitCard, { props: { periodLimit: { state: 'unavailable' } } });

    expect(wrapper.text()).toContain('Конверт текущего периода не настроен');
    expect(wrapper.text()).not.toContain('Лимит:');
  });
});
