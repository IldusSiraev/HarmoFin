import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import { useSortableList } from './useSortableList.js';

afterEach(() => vi.restoreAllMocks());

function harness(onMove = vi.fn(), onDrop = vi.fn()) {
  const component = defineComponent({
    setup() {
      const container = ref<HTMLElement | null>(null);
      const sortable = useSortableList({ container, itemSelector: '[data-item]', onMove, onDrop });
      return () =>
        h(
          'ol',
          { ref: container },
          [0, 1, 2].map((index) =>
            h('li', { 'data-item': '', 'data-index': index }, [
              h('span', {
                'data-handle': index,
                onPointerdown: (event: PointerEvent) => sortable.startDrag(event, index),
              }),
            ]),
          ),
        );
    },
  });
  const wrapper = mount(component, { attachTo: document.body });
  // Items 40px high at 0, 40, 80: midpoints 20, 60, 100.
  wrapper.findAll('[data-item]').forEach((item, index) => {
    vi.spyOn(item.element, 'getBoundingClientRect').mockReturnValue({
      top: index * 40,
      height: 40,
      bottom: index * 40 + 40,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: index * 40,
      toJSON: () => ({}),
    });
  });
  return { wrapper, onMove, onDrop };
}

const pointer = (type: string, clientY: number) =>
  new MouseEvent(type, { clientY, button: 0, bubbles: true, cancelable: true });

describe('useSortableList', () => {
  it('переставляет при движении ниже середины соседа и сообщает итоговый индекс', async () => {
    const { wrapper, onMove, onDrop } = harness();
    wrapper.find('[data-handle="0"]').element.dispatchEvent(pointer('pointerdown', 20));
    window.dispatchEvent(pointer('pointermove', 70));
    expect(onMove).toHaveBeenLastCalledWith(0, 1);
    window.dispatchEvent(pointer('pointermove', 110));
    expect(onMove).toHaveBeenLastCalledWith(1, 2);
    window.dispatchEvent(pointer('pointerup', 110));
    expect(onDrop).toHaveBeenCalledWith(2);
    window.dispatchEvent(pointer('pointermove', 0));
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it('не реагирует на правую кнопку', () => {
    const { wrapper, onMove } = harness();
    wrapper
      .find('[data-handle="0"]')
      .element.dispatchEvent(new MouseEvent('pointerdown', { button: 2, clientY: 20, bubbles: true }));
    window.dispatchEvent(pointer('pointermove', 110));
    expect(onMove).not.toHaveBeenCalled();
  });
});
