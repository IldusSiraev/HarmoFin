import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiListRow from './ListRow.vue';

const mountRow = () =>
  mount(UiListRow, {
    props: { label: 'Открыть операцию «Продукты»' },
    slots: {
      leading: '<span data-testid="icon">•</span>',
      default: '<span>Продукты</span>',
      trailing: '<span>-2 450 ₽</span>',
      actions: '<button data-testid="row-action" type="button">Действия</button>',
    },
  });

describe('UiListRow', () => {
  it('окрашивает плашку слева только когда задан тон', () => {
    const neutral = mountRow();
    expect(neutral.get('.ui-list-row__leading').classes()).toEqual(['ui-list-row__leading']);

    const tinted = mount(UiListRow, {
      props: { label: 'Перевод', leadingTone: 'transfer' },
      slots: { leading: '<span>•</span>' },
    });
    expect(tinted.get('.ui-list-row__leading').classes()).toContain(
      'ui-list-row__leading--transfer',
    );
  });

  it('exposes the row as one labelled button', () => {
    const wrapper = mountRow();
    const button = wrapper.get('[data-testid="list-row-select"]');

    expect(button.attributes('aria-label')).toBe('Открыть операцию «Продукты»');
    expect(button.text()).toContain('Продукты');
    expect(button.text()).toContain('-2 450 ₽');
  });

  it('selects the row when the button is pressed', async () => {
    const wrapper = mountRow();

    await wrapper.get('[data-testid="list-row-select"]').trigger('click');

    expect(wrapper.emitted('select')).toHaveLength(1);
  });

  it('keeps actions outside the button so they do not select the row', async () => {
    const wrapper = mountRow();
    const action = wrapper.get('[data-testid="row-action"]');

    expect(action.element.closest('[data-testid="list-row-select"]')).toBeNull();

    await action.trigger('click');

    expect(wrapper.emitted('select')).toBeUndefined();
  });
});
