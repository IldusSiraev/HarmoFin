import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import HelpPage from './help.vue';

describe('HelpPage', () => {
  it('explains the core terms in plain language', () => {
    const wrapper = mount(HelpPage);
    const text = wrapper.text();

    expect(text).toContain('Как пользоваться HarmoFin');
    expect(text).toContain('Счёт');
    expect(text).toContain('Конверт');
    expect(text).toContain('Финансовый месяц');
    expect(text).toContain('Можно потратить');
  });

  it('answers common questions in a details/summary list', () => {
    const wrapper = mount(HelpPage);
    const summaries = wrapper.findAll('summary');

    expect(summaries.length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain('Чем счёт отличается от конверта?');
  });
});
