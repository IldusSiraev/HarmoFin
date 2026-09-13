import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import RoadmapSection from './RoadmapSection.vue';

describe('RoadmapSection', () => {
  it('separates what exists now from what comes next', () => {
    const wrapper = mount(RoadmapSection);

    expect(wrapper.get('section').attributes('id')).toBe('roadmap');
    const now = wrapper.get('[data-testid="roadmap-now"]');
    const next = wrapper.get('[data-testid="roadmap-next"]');

    expect(now.findAll('li')).toHaveLength(6);
    expect(next.findAll('li')).toHaveLength(6);
    expect(now.text()).toContain('Конверты');
    expect(next.text()).toContain('Банковские интеграции');
    expect(now.text()).not.toContain('Банковские интеграции');
  });
});
