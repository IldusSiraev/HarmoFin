import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OperationGroup from './OperationGroup.vue';

describe('OperationGroup', () => {
  it('heads the day and lists its rows', () => {
    const wrapper = mount(OperationGroup, {
      props: { label: 'Сегодня, 14 сентября' },
      slots: { default: '<li data-testid="row">Продукты</li>' },
    });

    expect(wrapper.get('[data-testid="operation-group-label"]').text()).toBe(
      'Сегодня, 14 сентября',
    );
    expect(wrapper.get('ul').attributes('aria-label')).toBe('Операции за Сегодня, 14 сентября');
    expect(wrapper.findAll('[data-testid="row"]')).toHaveLength(1);
  });
});
