import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import AnalyticsSection from './AnalyticsSection.vue';

beforeEach(() => {
  Reflect.deleteProperty(window, 'IntersectionObserver');
});

describe('AnalyticsSection', () => {
  it('presents the analytics promise from the brief', async () => {
    const wrapper = mount(AnalyticsSection, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('section').attributes('id')).toBe('analytics');
    expect(wrapper.get('h2').text()).toBe('Понимайте не только сегодня, но и всю картину.');
    expect(wrapper.text()).toContain(
      'Смотрите расходы по категориям, периодам, циклам, счетам и конвертам — и переходите от показателя к исходным операциям.',
    );
  });
});
