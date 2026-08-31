import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import WelcomePanel from './WelcomePanel.vue';

describe('WelcomePanel', () => {
  it('shows the project foundation status in Russian', () => {
    const wrapper = mount(WelcomePanel);

    expect(wrapper.get('h1').text()).toBe('HarmoFin');
    expect(wrapper.get('h2').text()).toBe('Основание проекта готово');
    expect(wrapper.text()).toContain('Продуктовые функции ещё не реализованы');
  });
});
