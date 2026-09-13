import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiSelect from './Select.vue';

const options = [{ value: 'a', label: 'A' }];

describe('UiSelect', () => {
  it('connects label and options', () => {
    const wrapper = mount(UiSelect, {
      props: { modelValue: 'a', name: 'status', label: 'Статус', options },
    });
    const select = wrapper.get('select');
    expect(wrapper.get('label').attributes('for')).toBe(select.attributes('id'));
    expect(select.findAll('option')).toHaveLength(1);
  });

  it('only renders a tooltip trigger when the tooltip prop is set', async () => {
    const withoutTooltip = mount(UiSelect, {
      props: { modelValue: '', name: 'status', label: 'Статус', options },
    });
    expect(withoutTooltip.find('.ui-select__tooltip-trigger').exists()).toBe(false);

    const withTooltip = mount(UiSelect, {
      props: {
        modelValue: '',
        name: 'envelopeType',
        label: 'Тип конверта',
        options,
        tooltip: 'Определяет, как конверт участвует в расчёте лимита периода.',
      },
    });
    const trigger = withTooltip.get('.ui-select__tooltip-trigger');
    await trigger.trigger('focusin');
    expect(withTooltip.get('[role="tooltip"]').text()).toBe(
      'Определяет, как конверт участвует в расчёте лимита периода.',
    );
  });
});
