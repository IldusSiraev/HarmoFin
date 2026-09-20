import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ReportFilters from './ReportFilters.vue';
import UiDatePicker from '../ui/DatePicker.vue';

describe('ReportFilters', () => {
  it('emits normalized URL-compatible filters', async () => {
    const wrapper = mount(ReportFilters, {
      props: {
        modelValue: { from: '', to: '', accountId: '', categoryId: '', envelopeId: '', type: '' },
      },
    });

    // The date field is a calendar widget, not a typable native input, so a
    // date change is exercised at its v-model boundary rather than by typing
    // into the (readonly, click-to-open) trigger — see DatePicker.test.ts for
    // that widget's own behaviour.
    const fromPicker = wrapper
      .findAllComponents(UiDatePicker)
      .find((picker) => picker.props('name') === 'from');
    await fromPicker!.vm.$emit('update:modelValue', '2026-08-10');

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
      expect.objectContaining({ from: '2026-08-10' }),
    ]);
  });
});
