import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CycleTimeline from './CycleTimeline.vue';

describe('CycleTimeline', () => {
  it('lists cycle milestones as an ordered list with captions', () => {
    const wrapper = mount(CycleTimeline);

    const items = wrapper.findAll('ol li');
    expect(items).toHaveLength(4);
    expect(items[0]?.text()).toContain('10 сентября');
    expect(items[0]?.text()).toContain('Новый цикл');
    expect(items[1]?.text()).toContain('Следующая выплата');
    expect(items[2]?.text()).toContain('Граница периода');
    expect(wrapper.text()).toContain('Период 1');
    expect(wrapper.text()).toContain('Период 2');
    expect(wrapper.text()).not.toContain('Период 25');
  });
});
