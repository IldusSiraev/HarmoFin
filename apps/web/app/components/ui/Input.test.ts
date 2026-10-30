import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiInput from './Input.vue';

describe('UiInput', () => {
  it('connects label, hint and field error without replacing visible label', () => {
    const wrapper = mount(UiInput, {
      props: {
        modelValue: '',
        name: 'name',
        label: 'Название',
        hint: 'До 120 символов',
        error: 'Заполните поле',
      },
    });
    const input = wrapper.get('input');

    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'));
    expect(wrapper.get('label').text()).toBe('Название');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toContain(`${input.attributes('id')}-hint`);
    expect(input.attributes('aria-describedby')).toContain(`${input.attributes('id')}-error`);
  });

  it('emits model updates and blur from native input', async () => {
    const wrapper = mount(UiInput, {
      props: { modelValue: '', name: 'email', label: 'Email', type: 'email' },
    });

    await wrapper.get('input').setValue('user@example.test');
    await wrapper.get('input').trigger('blur');

    expect(wrapper.emitted('update:modelValue')).toEqual([['user@example.test']]);
    expect(wrapper.emitted('blur')).toHaveLength(1);
  });

  it('only renders a tooltip trigger when the tooltip prop is set', async () => {
    const withoutTooltip = mount(UiInput, {
      props: { modelValue: '', name: 'name', label: 'Название' },
    });
    expect(withoutTooltip.find('.ui-field__tooltip-trigger').exists()).toBe(false);

    const withTooltip = mount(UiInput, {
      props: {
        modelValue: '',
        name: 'startingBalance',
        label: 'Начальный баланс',
        tooltip: 'Сумма на счёте на дату начала учёта.',
      },
    });
    const trigger = withTooltip.get('.ui-field__tooltip-trigger');
    await trigger.trigger('focusin');
    expect(withTooltip.get('[role="tooltip"]').text()).toBe('Сумма на счёте на дату начала учёта.');
  });

  it('puts a decorative icon inside the control instead of beside the label', () => {
    const withoutIcon = mount(UiInput, {
      props: { modelValue: '', name: 'name', label: 'Название' },
    });
    expect(withoutIcon.find('.ui-field__icon').exists()).toBe(false);

    const withIcon = mount(UiInput, {
      props: { modelValue: '', name: 'search', label: 'Поиск по операциям' },
      slots: { icon: '<span data-testid="search-icon">i</span>' },
    });
    const icon = withIcon.get('.ui-field__icon');

    expect(icon.attributes('aria-hidden')).toBe('true');
    expect(icon.element.nextElementSibling).toBe(withIcon.get('input').element);
    expect(withIcon.get('input').classes()).toContain('ui-field__control--with-icon');
  });

  it('renders a labelled time field with a step and no text input mode', async () => {
    const wrapper = mount(UiInput, {
      props: {
        modelValue: '17:00',
        name: 'start',
        label: 'Начало',
        type: 'time',
        step: 300,
        inputmode: 'numeric',
      },
    });
    const input = wrapper.get('input[type="time"]');

    expect(wrapper.get('label').text()).toBe('Начало');
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'));
    expect(input.attributes('step')).toBe('300');
    expect(input.attributes('inputmode')).toBeUndefined();
    await input.setValue('17:30');
    expect(wrapper.emitted('update:modelValue')).toEqual([['17:30']]);
  });
});
