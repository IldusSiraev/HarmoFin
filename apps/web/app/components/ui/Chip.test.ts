import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiChip from './Chip.vue';

describe('UiChip', () => {
  it('shows only its label and no clear button while nothing is chosen', () => {
    const wrapper = mount(UiChip, { props: { label: 'Счёт' } });

    expect(wrapper.text()).toBe('Счёт');
    expect(wrapper.find('[data-testid="chip-clear"]').exists()).toBe(false);
  });

  it('shows the chosen value with a named clear button', () => {
    const wrapper = mount(UiChip, { props: { label: 'Счёт', value: 'Основная карта' } });

    expect(wrapper.text()).toContain('Счёт');
    expect(wrapper.text()).toContain('Основная карта');
    expect(wrapper.get('[data-testid="chip-clear"]').attributes('aria-label')).toBe(
      'Сбросить фильтр «Счёт»',
    );
  });

  it('puts passed attributes on the trigger button', () => {
    const wrapper = mount(UiChip, {
      props: { label: 'Счёт' },
      attrs: { 'data-testid': 'chip-account', 'aria-expanded': 'true' },
    });

    const trigger = wrapper.get('[data-testid="chip-account"]');
    expect(trigger.element.tagName).toBe('BUTTON');
    expect(trigger.attributes('aria-expanded')).toBe('true');
  });

  it('emits click from the trigger and clear from the clear button', async () => {
    const wrapper = mount(UiChip, { props: { label: 'Тип', value: 'Расход' } });

    await wrapper.get('.ui-chip__trigger').trigger('click');
    await wrapper.get('[data-testid="chip-clear"]').trigger('click');

    expect(wrapper.emitted('click')).toHaveLength(1);
    expect(wrapper.emitted('clear')).toHaveLength(1);
  });
});
