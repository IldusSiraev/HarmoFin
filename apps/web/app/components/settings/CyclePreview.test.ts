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

  it('shows the future action block with the API date and separates it from past periods', () => {
    const wrapper = mount(CyclePreview, {
      props: {
        cycleStartDay: 12,
        periodBoundaryOffset: 14,
        effectiveOn: '2026-11-12',
        transitionRanges: [{ start: '2026-10-01', end: '2026-11-11' }],
        decisions: {},
        errors: {},
      },
    });
    const text = wrapper.text();
    expect(text).toContain('Действует с 12.11.2026');
    expect(text).toContain('Изменение действует только с будущего периода');
    expect(text).toContain('Прошлые периоды остаются без изменений');
    expect(text).toContain('01.10.2026');
    expect(wrapper.find('[data-testid="cycle-effect-heading"]').attributes('tabindex')).toBe('-1');
  });

  it('emits decision updates for a transition target and the no-target checkbox', async () => {
    const wrapper = mount(CyclePreview, {
      props: {
        cycleStartDay: 12,
        periodBoundaryOffset: 14,
        effectiveOn: '2026-11-12',
        transitionRanges: [{ start: '2026-10-01', end: '2026-11-11' }],
        decisions: {},
        errors: {},
      },
    });
    await wrapper.get('input[name="transitionTarget-2026-10-01"]').setValue('1500.50');
    await wrapper.get('input[name="transitionNoTarget-2026-10-01"]').setValue(true);
    expect(wrapper.emitted('decision')).toEqual([
      ['2026-10-01', { target: '1500.50', noTarget: false }],
      ['2026-10-01', { target: '', noTarget: true }],
    ]);
  });
});
