import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiButtonGroup from './ButtonGroup.vue';

const options = [
  { value: '', label: 'Все' },
  { value: 'INCOME', label: 'Доходы' },
];

describe('UiButtonGroup', () => {
  it('names the group and marks only the current option pressed', () => {
    const wrapper = mount(UiButtonGroup, {
      props: { options, modelValue: 'INCOME', label: 'Тип', testidPrefix: 'type' },
    });

    expect(wrapper.get('[role="group"]').attributes('aria-label')).toBe('Тип');
    expect(wrapper.get('[data-testid="type-all"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('[data-testid="type-INCOME"]').attributes('aria-pressed')).toBe('true');
  });

  it('emits the chosen value', async () => {
    const wrapper = mount(UiButtonGroup, {
      props: { options, modelValue: '', label: 'Тип', testidPrefix: 'type' },
    });

    await wrapper.get('[data-testid="type-INCOME"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([['INCOME']]);
  });
});
