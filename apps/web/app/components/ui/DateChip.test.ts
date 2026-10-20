import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UiDateChip from './DateChip.vue';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 20));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UiDateChip', () => {
  it('reads the chosen period on the chip, the year said once', () => {
    const wrapper = mount(UiDateChip, {
      props: { label: 'Период', from: '2026-10-01', to: '2026-10-20' },
    });

    expect(wrapper.text()).toContain('01.10 – 20.10.2026');
  });

  it('reads an open-ended period and a single date', () => {
    expect(
      mount(UiDateChip, { props: { label: 'Период', from: '2026-10-01', to: '' } }).text(),
    ).toContain('с 01.10.2026');
    expect(
      mount(UiDateChip, { props: { label: 'На дату', to: '2026-03-31', range: false } }).text(),
    ).toContain('31.03.2026');
  });

  it('applies a preset period and closes', async () => {
    const wrapper = mount(UiDateChip, {
      attachTo: document.body,
      props: { label: 'Период', to: '' },
    });

    await wrapper.get('.ui-chip__trigger').trigger('click');
    const lastMonth = wrapper
      .findAll('.ui-date-chip__preset')
      .find((button) => button.text() === 'Прошлый месяц');
    await lastMonth!.trigger('click');

    expect(wrapper.emitted('change')).toEqual([[{ from: '2026-09-01', to: '2026-09-30' }]]);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('clears the period from the chip', async () => {
    const wrapper = mount(UiDateChip, {
      props: { label: 'Период', from: '2026-10-01', to: '2026-10-20' },
    });

    await wrapper.get('[data-testid="chip-clear"]').trigger('click');

    expect(wrapper.emitted('change')).toEqual([[{ from: '', to: '' }]]);
  });

  it('closes on Escape', async () => {
    const wrapper = mount(UiDateChip, {
      attachTo: document.body,
      props: { label: 'Период', to: '' },
    });
    await wrapper.get('.ui-chip__trigger').trigger('click');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
