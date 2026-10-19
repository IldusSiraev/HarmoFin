import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { cycleErrors } from './demo-cycle.js';
import DemoCycleStep from './DemoCycleStep.vue';

describe('demo cycle step', () => {
  it.each([
    ['10', '15', {}],
    ['0', '15', { start: 'Укажите день от 1 до 28.' }],
    ['29', '15', { start: 'Укажите день от 1 до 28.' }],
    ['10', '28', { offset: 'Укажите число дней от 1 до 27.' }],
    ['abc', '', { start: 'Укажите день от 1 до 28.', offset: 'Укажите число дней от 1 до 27.' }],
  ])('validates start=%s offset=%s', (start, offset, expected) => {
    expect(cycleErrors(start, offset)).toEqual(expected);
  });

  it('renders both settings fields and no cycle preview of its own', () => {
    const wrapper = mount(DemoCycleStep, { props: { start: '5', offset: '10' } });
    expect(wrapper.text()).toContain('Начало первого периода');
    expect(wrapper.text()).toContain('Граница второго периода (дней от начала первого)');
    expect(wrapper.findComponent({ name: 'SettingsCyclePreview' }).exists()).toBe(false);
  });

  it('shows field errors for invalid input', () => {
    const wrapper = mount(DemoCycleStep, { props: { start: '40', offset: '10' } });
    expect(wrapper.text()).toContain('Укажите день от 1 до 28.');
    expect(wrapper.findComponent({ name: 'SettingsCyclePreview' }).exists()).toBe(false);
  });

  it('emits typed values', async () => {
    const wrapper = mount(DemoCycleStep, { props: { start: '10', offset: '15' } });
    await wrapper.get('[name="demo-cycle-start"]').setValue('12');
    expect(wrapper.emitted('update:start')?.at(-1)).toEqual(['12']);
  });
});
