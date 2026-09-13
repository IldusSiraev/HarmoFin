import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ReferencePageLayout from './ReferencePageLayout.vue';

describe('ReferencePageLayout', () => {
  it('renders provided slots in order and omits the kicker/filters when absent', () => {
    const wrapper = mount(ReferencePageLayout, {
      slots: {
        kicker: 'Справочники',
        title: 'Счета',
        description: 'Храните счета и их подтверждённые остатки.',
        actions: '<button type="button">Создать счёт</button>',
        content: '<p data-content>Список счетов</p>',
      },
    });

    expect(wrapper.find('.reference-page-layout__kicker').text()).toBe('Справочники');
    expect(wrapper.get('h1').text()).toBe('Счета');
    expect(wrapper.get('.reference-page-layout__description').text()).toBe(
      'Храните счета и их подтверждённые остатки.',
    );
    expect(wrapper.find('.reference-page-layout__filters').exists()).toBe(false);
    expect(wrapper.get('[data-content]').text()).toBe('Список счетов');
  });

  it('renders the filters block only when the slot is provided', () => {
    const wrapper = mount(ReferencePageLayout, {
      slots: { title: 'Счета', filters: '<div data-filters>Показать счета</div>' },
    });

    expect(wrapper.get('.reference-page-layout__filters').find('[data-filters]').exists()).toBe(
      true,
    );
  });
});
