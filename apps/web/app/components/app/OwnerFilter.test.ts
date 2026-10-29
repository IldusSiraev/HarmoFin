import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OwnerFilter from './OwnerFilter.vue';
import UiButtonGroup from '../ui/ButtonGroup.vue';

const toggleOptions = [
  { value: 'all', label: 'Все' },
  { value: 'mine', label: 'Мои' },
];

describe('OwnerFilter', () => {
  it('renders the «Владелец» toggle and emits the chosen value', async () => {
    const wrapper = mount(OwnerFilter, {
      props: { kind: 'toggle', options: toggleOptions, modelValue: 'all' },
    });

    expect(wrapper.getComponent(UiButtonGroup).props('label')).toBe('Владелец');

    await wrapper.get('[data-testid="owner-filter-mine"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([['mine']]);
  });

  it('renders nothing for a single-member family', () => {
    const wrapper = mount(OwnerFilter, {
      props: { kind: 'none', options: [], modelValue: 'all' },
    });

    expect(wrapper.find('[role="group"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });
});
