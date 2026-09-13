import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import StepStrip from './StepStrip.vue';

const normalize = (value: string): string => value.replace(/[\u00A0\u202F ]/g, ' ');

describe('StepStrip', () => {
  it('renders five ordered steps in the order from the brief', () => {
    const wrapper = mount(StepStrip);
    const items = wrapper.findAll('ol li');

    expect(items).toHaveLength(5);
    expect(items[0]?.text()).toContain('01');
    expect(items[0]?.text()).toContain('Получили зарплату');
    expect(normalize(items[0]?.text() ?? '')).toContain('+106 000 ₽');
    expect(items[4]?.text()).toContain('Накопления продолжают расти');
  });
});
