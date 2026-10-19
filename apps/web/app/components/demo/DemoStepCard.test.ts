import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DemoStepCard from './DemoStepCard.vue';

const choices = [
  { value: 'suggested', label: 'Как предлагает HarmoFin', hint: '45 000 ₽ на текущие траты' },
  { value: 'vacation', label: 'Больше отложить на отпуск', hint: '25 000 ₽ в отпуск' },
];

describe('demo step card', () => {
  it('renders the step heading and announces progress politely', () => {
    const wrapper = mount(DemoStepCard, {
      props: { step: 2, title: 'Распределите', body: 'Текст' },
    });
    expect(wrapper.get('h2').text()).toBe('Распределите');
    expect(wrapper.get('h2').attributes('tabindex')).toBe('-1');
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Шаг 3 из 7');
  });

  it('renders choices as a labelled group of toggle buttons and marks the selected one in text', () => {
    const wrapper = mount(DemoStepCard, {
      props: { step: 2, title: 'Распределите', body: 'Текст', choices, selected: 'vacation' },
    });
    const group = wrapper.get('[role="group"]');
    expect(group.attributes('aria-label')).toBe('Выберите вариант');
    const buttons = wrapper.findAll('button[aria-pressed]');
    expect(buttons.map((b) => b.attributes('aria-pressed'))).toEqual(['false', 'true']);
    expect(buttons[1]!.text()).toContain('Выбрано');
  });

  it('emits the chosen value', async () => {
    const wrapper = mount(DemoStepCard, {
      props: { step: 5, title: 'Конец', body: 'Текст', choices },
    });
    await wrapper.findAll('button[aria-pressed]')[0]!.trigger('click');
    expect(wrapper.emitted('choose')?.[0]).toEqual(['suggested']);
  });
});
