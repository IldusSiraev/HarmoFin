import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ReportFilters from './ReportFilters.vue';

describe('ReportFilters', () => {
  it('emits normalized URL-compatible filters', async () => {
    const wrapper = mount(ReportFilters, {
      props: {
        modelValue: { from: '', to: '', accountId: '', categoryId: '', envelopeId: '', type: '' },
      },
    });

    await wrapper.get('input[name="from"]').setValue('2026-08-10');

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
      expect.objectContaining({ from: '2026-08-10' }),
    ]);
  });
});
