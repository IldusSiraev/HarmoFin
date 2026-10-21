import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiBeforeAfter from './BeforeAfter.vue';

describe('UiBeforeAfter', () => {
  it('показывает строки «было → стало»', () => {
    const wrapper = mount(UiBeforeAfter, {
      props: {
        rows: [
          { label: 'Отпуск', beforeMinor: '14850000', afterMinor: '14000000' },
          { label: 'Резерв', beforeMinor: '6200000', afterMinor: '7050000' },
        ],
      },
    });
    const rows = wrapper.findAll('[data-testid="before-after-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('Отпуск');
    expect(rows[0]!.text()).toMatch(/148\s500,00.*140\s000,00/);
  });

  it('стрелка скрыта от чтения, между значениями — скрытый текст «станет»', () => {
    const wrapper = mount(UiBeforeAfter, {
      props: { rows: [{ label: 'Отпуск', beforeMinor: '100', afterMinor: '200' }] },
    });
    const svg = wrapper.get('svg');
    expect(svg.attributes('aria-hidden')).toBe('true');
    expect(svg.attributes('aria-label')).toBeUndefined();
    const hidden = wrapper.get('.ui-before-after__sr');
    expect(hidden.text()).toBe('станет');
    expect(wrapper.get('dd').text()).toMatch(/1,00.*станет.*2,00/);
  });
});
