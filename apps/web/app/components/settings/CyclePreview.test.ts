import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CyclePreview from './CyclePreview.vue';

describe('CyclePreview', () => {
  it('labels both segments with the computed boundary day', () => {
    const wrapper = mount(CyclePreview, {
      props: { cycleStartDay: 10, periodBoundaryOffset: 15 },
    });
    const text = wrapper.text();
    expect(text).toContain('10–25');
    expect(text).toContain('25–10');
  });

  it('does not clamp the boundary day back into the calendar month', () => {
    const wrapper = mount(CyclePreview, {
      props: { cycleStartDay: 25, periodBoundaryOffset: 15 },
    });
    const text = wrapper.text();
    expect(text).toContain('25–40');
    expect(text).toContain('40–25');
  });
});
