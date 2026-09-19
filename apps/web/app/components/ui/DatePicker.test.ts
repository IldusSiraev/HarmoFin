import { flushPromises, mount } from '@vue/test-utils';
import { VueDatePicker } from '@vuepic/vue-datepicker';
import { describe, expect, it } from 'vitest';

import UiDatePicker from './DatePicker.vue';

describe('UiDatePicker', () => {
  it('connects label to the trigger and shows the formatted value', async () => {
    const wrapper = mount(UiDatePicker, {
      props: { modelValue: '2026-09-19', name: 'occurredOn', label: 'Дата', required: true },
      attachTo: document.body,
    });
    await flushPromises();
    const input = wrapper.get('input');

    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'));
    expect(wrapper.get('label').text()).toBe('Дата *');
    expect((input.element as HTMLInputElement).value).toBe('19.09.2026');
    // Calendar-only selection: typing is blocked without the readonly attribute
    // itself (which would also block opening the popover) — the library
    // enforces it via this class plus inputmode="none" instead.
    expect(input.classes()).toContain('dp--input-readonly');
    wrapper.unmount();
  });

  it('emits the ISO date string a calendar selection resolves to', async () => {
    const wrapper = mount(UiDatePicker, {
      props: { modelValue: '', name: 'occurredOn', label: 'Дата' },
      attachTo: document.body,
    });

    await flushPromises();
    // The component only forwards what VueDatePicker itself emits, so drive
    // it the same way: through the underlying library's own model event.
    const datepicker = wrapper.findComponent(VueDatePicker);
    await datepicker.vm.$emit('update:modelValue', '2026-09-19');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['2026-09-19']);
    wrapper.unmount();
  });

  it('shows a clear button once a value is set on an optional field, not a required one', async () => {
    const optional = mount(UiDatePicker, {
      props: { modelValue: '2026-09-19', name: 'targetDate', label: 'Дата цели' },
      attachTo: document.body,
    });
    await flushPromises();
    expect(optional.find('[aria-label="Очистить дату"]').exists()).toBe(true);
    optional.unmount();

    const required = mount(UiDatePicker, {
      props: { modelValue: '2026-09-19', name: 'occurredOn', label: 'Дата', required: true },
      attachTo: document.body,
    });
    await flushPromises();
    expect(required.find('[aria-label="Очистить дату"]').exists()).toBe(false);
    required.unmount();
  });

  it('clearing emits an empty string', async () => {
    const wrapper = mount(UiDatePicker, {
      props: { modelValue: '2026-09-19', name: 'targetDate', label: 'Дата цели' },
      attachTo: document.body,
    });
    await flushPromises();

    await wrapper.get('[aria-label="Очистить дату"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['']);
    wrapper.unmount();
  });
});
