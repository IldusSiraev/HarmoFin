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

describe('searchable mode', () => {
  const options = [
    { value: 'Europe/Moscow', label: 'Europe/Moscow' },
    { value: 'Europe/Paris', label: 'Europe/Paris' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  ];

  function mountSearchable(modelValue = '') {
    return mount(UiSelect, {
      props: { modelValue, name: 'timezone', label: 'Часовой пояс', options, searchable: true },
    });
  }

  it('renders a text combobox instead of a native select', () => {
    const wrapper = mountSearchable();
    expect(wrapper.find('select').exists()).toBe(false);
    expect(wrapper.find('input[role="combobox"]').exists()).toBe(true);
  });

  it('filters options by label substring on input', async () => {
    const wrapper = mountSearchable();
    await wrapper.get('input[role="combobox"]').setValue('par');
    const optionTexts = wrapper.findAll('[role="option"]').map((node) => node.text());
    expect(optionTexts).toEqual(['Europe/Paris']);
  });

  it('selecting an option emits its value and shows its label', async () => {
    const wrapper = mountSearchable();
    await wrapper.get('input[role="combobox"]').trigger('focus');
    await wrapper.get('[role="option"]').trigger('mousedown');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['Europe/Moscow']);
    await wrapper.setProps({ modelValue: 'Europe/Moscow' });
    expect((wrapper.get('input[role="combobox"]').element as HTMLInputElement).value).toBe(
      'Europe/Moscow',
    );
  });

  it('ArrowDown then Enter selects the first filtered option', async () => {
    const wrapper = mountSearchable();
    const input = wrapper.get('input[role="combobox"]');
    await input.trigger('focus');
    await input.setValue('tok');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['Asia/Tokyo']);
  });

  it('Escape closes the popup and reverts the query to the selected label', async () => {
    const wrapper = mountSearchable('Europe/Paris');
    const input = wrapper.get('input[role="combobox"]');
    await input.trigger('focus');
    await input.setValue('xyz');
    await input.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect((input.element as HTMLInputElement).value).toBe('Europe/Paris');
  });
});
