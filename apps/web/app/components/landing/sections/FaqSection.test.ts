import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FaqSection from './FaqSection.vue';

describe('FaqSection', () => {
  it('renders every question collapsed with accessible wiring', () => {
    const wrapper = mount(FaqSection);
    const buttons = wrapper.findAll('[data-testid="faq-question"]');

    expect(wrapper.get('section').attributes('id')).toBe('faq');
    expect(buttons).toHaveLength(6);
    expect(buttons[0]?.attributes('aria-expanded')).toBe('false');
    expect(buttons[0]?.attributes('aria-controls')).toBe('faq-panel-what-is');
    expect(wrapper.find('#faq-panel-what-is').exists()).toBe(false);
  });

  it('opens a question on activation and labels its panel', async () => {
    const wrapper = mount(FaqSection);
    const button = wrapper.findAll('[data-testid="faq-question"]')[0];

    await button?.trigger('click');

    const panel = wrapper.get('#faq-panel-what-is');
    expect(button?.attributes('aria-expanded')).toBe('true');
    expect(panel.attributes('role')).toBe('region');
    expect(panel.attributes('aria-labelledby')).toBe('faq-question-what-is');
    expect(panel.text()).toContain('веб-приложение для управления личным и семейным бюджетом');
  });

  it('keeps at most one question open', async () => {
    const wrapper = mount(FaqSection);
    const buttons = wrapper.findAll('[data-testid="faq-question"]');

    await buttons[0]?.trigger('click');
    await buttons[1]?.trigger('click');

    expect(buttons[0]?.attributes('aria-expanded')).toBe('false');
    expect(buttons[1]?.attributes('aria-expanded')).toBe('true');
    expect(wrapper.findAll('[role="region"]')).toHaveLength(1);
  });

  it('closes an open question when it is activated again', async () => {
    const wrapper = mount(FaqSection);
    const button = wrapper.findAll('[data-testid="faq-question"]')[0];

    await button?.trigger('click');
    await button?.trigger('click');

    expect(button?.attributes('aria-expanded')).toBe('false');
    expect(wrapper.findAll('[role="region"]')).toHaveLength(0);
  });
});
