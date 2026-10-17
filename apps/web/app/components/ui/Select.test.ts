import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

import UiDrawer from './Drawer.vue';
import FilterPanel from './FilterPanel.vue';
import UiSelect from './Select.vue';

const options = [
  { value: 'a', label: 'Альфа' },
  { value: 'b', label: 'Бета', disabled: true },
  { value: 'c', label: 'Вега' },
  { value: 'd', label: 'Вектор' },
  { value: 'e', label: 'Гамма' },
];

type Props = Partial<{
  modelValue: string;
  placeholder: string;
  hint: string;
  error: string;
  required: boolean;
  disabled: boolean;
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
}>;

function mountSelect(props: Props = {}) {
  return mount(UiSelect, {
    attachTo: document.body,
    props: { modelValue: 'a', name: 'status', label: 'Статус', options, ...props },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('UiSelect', () => {
  it('renders a select-only combobox wired to its listbox and label', () => {
    const wrapper = mountSelect();
    expect(wrapper.find('select').exists()).toBe(false);
    const trigger = wrapper.get('[role="combobox"]');
    const label = wrapper.get('label');
    expect(trigger.attributes('id')).toBe('status-select');
    expect(label.attributes('id')).toBe('status-select-label');
    expect(trigger.attributes('aria-labelledby')).toBe('status-select-label');
    expect(trigger.attributes('tabindex')).toBe('0');
    expect(trigger.attributes('aria-haspopup')).toBe('listbox');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.attributes('aria-controls')).toBe('status-select-listbox');
    expect(wrapper.get('[role="listbox"]').attributes('id')).toBe('status-select-listbox');
    expect(trigger.text()).toBe('Альфа');
  });

  it('renders options with unique ids, selection and disabled state', () => {
    const wrapper = mountSelect();
    const nodes = wrapper.findAll('[role="option"]');
    expect(nodes).toHaveLength(5);
    const ids = nodes.map((node) => node.attributes('id'));
    expect(new Set(ids).size).toBe(5);
    expect(nodes[0]!.attributes('aria-selected')).toBe('true');
    expect(nodes[2]!.attributes('aria-selected')).toBe('false');
    expect(nodes[1]!.attributes('aria-disabled')).toBe('true');
    expect(nodes[0]!.attributes('aria-disabled')).toBeUndefined();
  });

  it('carries name and value in a hidden input', async () => {
    const wrapper = mountSelect({ modelValue: 'c' });
    const hidden = wrapper.get('input[type="hidden"]');
    expect(hidden.attributes('name')).toBe('status');
    expect((hidden.element as HTMLInputElement).value).toBe('c');
    await wrapper.setProps({ modelValue: 'e' });
    expect((hidden.element as HTMLInputElement).value).toBe('e');
    expect(wrapper.find('[data-select-name="status"]').exists()).toBe(true);
  });

  it('shows the placeholder when no option matches', () => {
    const wrapper = mountSelect({ modelValue: '', placeholder: 'Выберите' });
    const value = wrapper.get('.ui-select__value');
    expect(value.text()).toBe('Выберите');
    expect(value.classes()).toContain('ui-select__value--placeholder');
  });

  it('describes hint and error and marks invalid and required', () => {
    const wrapper = mountSelect({ hint: 'Подсказка', error: 'Ошибка', required: true });
    const trigger = wrapper.get('[role="combobox"]');
    expect(trigger.attributes('aria-describedby')).toBe('status-select-hint status-select-error');
    expect(wrapper.get('#status-select-hint').text()).toBe('Подсказка');
    expect(wrapper.get('#status-select-error').text()).toBe('Ошибка');
    expect(trigger.attributes('aria-invalid')).toBe('true');
    expect(trigger.attributes('aria-required')).toBe('true');
  });

  it('toggles by click and selects an option by click', async () => {
    const wrapper = mountSelect();
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger('click');
    expect(trigger.attributes('aria-expanded')).toBe('true');
    await trigger.trigger('click');
    expect(trigger.attributes('aria-expanded')).toBe('false');

    await trigger.trigger('click');
    const option = wrapper.findAll('[role="option"]')[2]!;
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    option.element.dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);
    await option.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['c']]);
    expect(trigger.attributes('aria-expanded')).toBe('false');
  });

  it('ignores clicks on disabled options and on the already selected option', async () => {
    const wrapper = mountSelect();
    await wrapper.get('[role="combobox"]').trigger('click');
    await wrapper.findAll('[role="option"]')[1]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.get('[role="combobox"]').attributes('aria-expanded')).toBe('true');
    await wrapper.findAll('[role="option"]')[0]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.get('[role="combobox"]').attributes('aria-expanded')).toBe('false');
  });

  it.each(['Enter', ' ', 'ArrowDown', 'ArrowUp'])(
    'opens with %j on the selected option',
    async (key) => {
      const wrapper = mountSelect({ modelValue: 'c' });
      const trigger = wrapper.get('[role="combobox"]');
      await trigger.trigger('keydown', { key });
      expect(trigger.attributes('aria-expanded')).toBe('true');
      expect(trigger.attributes('aria-activedescendant')).toBe('status-select-listbox-option-2');
      expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    },
  );

  it('opens on the first enabled option when nothing is selected', async () => {
    const wrapper = mountSelect({
      modelValue: '',
      options: [{ value: 'x', label: 'Икс', disabled: true }, ...options],
    });
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    expect(trigger.attributes('aria-activedescendant')).toBe('status-select-listbox-option-1');
  });

  it('moves with arrows skipping disabled options without wrapping', async () => {
    const wrapper = mountSelect();
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await trigger.trigger('keydown', { key: 'ArrowUp' });
    expect(trigger.attributes('aria-activedescendant')).toBe('status-select-listbox-option-0');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    expect(trigger.attributes('aria-activedescendant')).toBe('status-select-listbox-option-2');
    await trigger.trigger('keydown', { key: 'ArrowUp' });
    expect(trigger.attributes('aria-activedescendant')).toBe('status-select-listbox-option-0');
    await trigger.trigger('keydown', { key: 'End' });
    expect(trigger.attributes('aria-activedescendant')).toBe('status-select-listbox-option-4');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    expect(trigger.attributes('aria-activedescendant')).toBe('status-select-listbox-option-4');
    await trigger.trigger('keydown', { key: 'Home' });
    expect(trigger.attributes('aria-activedescendant')).toBe('status-select-listbox-option-0');
    const active = wrapper.get('#status-select-listbox-option-0');
    expect(active.classes()).toContain('ui-select__option--active');
  });

  it('jumps by typeahead label prefix and resets the buffer after 500ms', async () => {
    vi.useFakeTimers();
    const wrapper = mountSelect();
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger('keydown', { key: 'Enter' });
    await trigger.trigger('keydown', { key: 'в' });
    await trigger.trigger('keydown', { key: 'е' });
    await trigger.trigger('keydown', { key: 'к' });
    expect(trigger.attributes('aria-activedescendant')).toBe('status-select-listbox-option-3');
    vi.advanceTimersByTime(600);
    await trigger.trigger('keydown', { key: 'Г' });
    expect(trigger.attributes('aria-activedescendant')).toBe('status-select-listbox-option-4');
    await trigger.trigger('keydown', { key: 'б' });
    expect(trigger.attributes('aria-activedescendant')).toBe('status-select-listbox-option-4');
  });

  it('Enter and Space select the active option and close', async () => {
    const wrapper = mountSelect();
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger('keydown', { key: 'Enter' });
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await trigger.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue')).toEqual([['c']]);
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.attributes('aria-activedescendant')).toBeUndefined();

    await trigger.trigger('keydown', { key: ' ' });
    await trigger.trigger('keydown', { key: 'End' });
    await trigger.trigger('keydown', { key: ' ' });
    expect(wrapper.emitted('update:modelValue')).toEqual([['c'], ['e']]);
  });

  it('Escape closes without change and keeps focus on the trigger', async () => {
    const wrapper = mountSelect();
    const trigger = wrapper.get('[role="combobox"]');
    (trigger.element as HTMLElement).focus();
    await trigger.trigger('keydown', { key: 'Enter' });
    await trigger.trigger('keydown', { key: 'End' });
    await trigger.trigger('keydown', { key: 'Escape' });
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(document.activeElement).toBe(trigger.element);
  });

  it('Tab closes without change', async () => {
    const wrapper = mountSelect();
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger('keydown', { key: 'Enter' });
    await trigger.trigger('keydown', { key: 'End' });
    await trigger.trigger('keydown', { key: 'Tab' });
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('closes on an outside pointerdown and stops listening afterwards', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const wrapper = mountSelect();
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger('click');
    wrapper
      .get('[role="listbox"]')
      .element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(trigger.attributes('aria-expanded')).toBe('true');
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(trigger.attributes('aria-expanded')).toBe('false');
  });

  it('emits blur when focus leaves the trigger', async () => {
    const wrapper = mountSelect();
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger('click');
    await trigger.trigger('blur');
    expect(wrapper.emitted('blur')).toHaveLength(1);
    expect(trigger.attributes('aria-expanded')).toBe('false');
  });

  it('cannot open when disabled', async () => {
    const wrapper = mountSelect({ disabled: true });
    const trigger = wrapper.get('[role="combobox"]');
    expect(trigger.attributes('aria-disabled')).toBe('true');
    expect(trigger.attributes('tabindex')).toBeUndefined();
    await trigger.trigger('click');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    expect(trigger.attributes('aria-expanded')).toBe('false');
  });

  it('focuses the trigger without opening when the label is clicked', async () => {
    const wrapper = mountSelect();
    await wrapper.get('label').trigger('click');
    const trigger = wrapper.get('[role="combobox"]');
    expect(document.activeElement).toBe(trigger.element);
    expect(trigger.attributes('aria-expanded')).toBe('false');
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

describe('UiSelect edge cases', () => {
  it.each([
    ['no options', []],
    ['only disabled options', [{ value: 'x', label: 'Икс', disabled: true }]],
  ])('omits aria-activedescendant with %s', async (_name, list) => {
    const wrapper = mountSelect({ modelValue: '', options: list });
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(trigger.attributes('aria-activedescendant')).toBeUndefined();
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await trigger.trigger('keydown', { key: 'Enter' });
    expect(trigger.attributes('aria-activedescendant')).toBeUndefined();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  function mockTrigger(wrapper: ReturnType<typeof mountSelect>, top: number, bottom: number) {
    const trigger = wrapper.get('[role="combobox"]').element as HTMLElement;
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      top,
      bottom,
      left: 0,
      right: 200,
      width: 200,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect);
  }

  it('opens upward when there is too little room below and more above', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    const wrapper = mountSelect();
    mockTrigger(wrapper, 700, 744);
    await wrapper.get('[role="combobox"]').trigger('click');
    expect(wrapper.get('[role="listbox"]').classes()).toContain('ui-select__listbox--up');
  });

  it('opens downward when there is room below', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    const wrapper = mountSelect();
    mockTrigger(wrapper, 100, 144);
    await wrapper.get('[role="combobox"]').trigger('click');
    expect(wrapper.get('[role="listbox"]').classes()).not.toContain('ui-select__listbox--up');
  });

  it('opens downward when below is short but above is even shorter', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(300);
    const wrapper = mountSelect();
    mockTrigger(wrapper, 100, 144);
    await wrapper.get('[role="combobox"]').trigger('click');
    expect(wrapper.get('[role="listbox"]').classes()).not.toContain('ui-select__listbox--up');
  });

  it('Escape with an open list closes only the list inside a UiDrawer', async () => {
    const Host = defineComponent({
      components: { UiDrawer, UiSelect },
      setup() {
        const open = ref(true);
        return { open, options };
      },
      template: `<UiDrawer :open="open" title="Фильтры" @close="open = false">
        <UiSelect model-value="a" name="status" label="Статус" :options="options" />
      </UiDrawer>`,
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger('click');
    await trigger.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(true);
    expect(trigger.attributes('aria-expanded')).toBe('false');
    await trigger.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[data-testid="drawer"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('Escape with an open list closes only the list inside a FilterPanel', async () => {
    const Host = defineComponent({
      components: { FilterPanel, UiSelect },
      setup: () => ({ options }),
      template: `<FilterPanel>
        <UiSelect model-value="a" name="status" label="Статус" :options="options" />
      </FilterPanel>`,
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await wrapper.get('button[aria-haspopup="true"]').trigger('click');
    const trigger = wrapper.get('[role="combobox"]');
    await trigger.trigger('click');
    await trigger.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[aria-label="Дополнительные фильтры"]').exists()).toBe(true);
    expect(trigger.attributes('aria-expanded')).toBe('false');
    await trigger.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[aria-label="Дополнительные фильтры"]').exists()).toBe(false);
    wrapper.unmount();
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

  it('uses the shared listbox option classes', async () => {
    const wrapper = mountSearchable('Europe/Paris');
    await wrapper.get('input[role="combobox"]').trigger('focus');
    const selected = wrapper.findAll('[role="option"]')[1]!;
    expect(selected.classes()).toContain('ui-select__option');
    expect(selected.classes()).toContain('ui-select__option--selected');
  });
});
