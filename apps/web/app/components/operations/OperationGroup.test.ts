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

  it('keeps its own card surface by default', () => {
    const wrapper = mount(OperationGroup, { props: { label: 'Сегодня' } });
    expect(wrapper.get('ul').classes()).not.toContain('operation-group__list--flat');
  });

  it('drops its own border/surface/shadow when flat, for nesting inside another card', () => {
    const wrapper = mount(OperationGroup, { props: { label: 'Сегодня', flat: true } });
    expect(wrapper.get('ul').classes()).toContain('operation-group__list--flat');
  });
});
