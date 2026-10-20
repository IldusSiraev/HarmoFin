import { onBeforeUnmount, ref, type Ref } from 'vue';

// Vertical drag-and-drop on pointer events (mouse and touch, no dependency).
// The list re-renders on every onMove, so the dragged item follows the pointer.
// Keyboard users reorder with explicit buttons; this is the pointer path only.

const EDGE = 48;
const STEP = 12;

export function useSortableList(options: {
  container: Ref<HTMLElement | null>;
  itemSelector: string;
  onMove: (from: number, to: number) => void;
  onDrop?: (index: number) => void;
}): { draggingIndex: Ref<number | null>; startDrag: (event: PointerEvent, index: number) => void } {
  const draggingIndex = ref<number | null>(null);

  function targetIndex(clientY: number): number {
    const items = Array.from(
      options.container.value?.querySelectorAll<HTMLElement>(options.itemSelector) ?? [],
    );
    let index = 0;
    items.forEach((item, position) => {
      if (position === draggingIndex.value) return;
      const rect = item.getBoundingClientRect();
      if (rect.top + rect.height / 2 < clientY) index += 1;
    });
    return index;
  }

  function onPointerMove(event: PointerEvent | MouseEvent): void {
    if (draggingIndex.value === null) return;
    event.preventDefault();
    if (event.clientY < EDGE) window.scrollBy(0, -STEP);
    else if (event.clientY > window.innerHeight - EDGE) window.scrollBy(0, STEP);
    const next = targetIndex(event.clientY);
    if (next !== draggingIndex.value) {
      options.onMove(draggingIndex.value, next);
      draggingIndex.value = next;
    }
  }

  function stop(): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  }

  function onPointerUp(): void {
    const index = draggingIndex.value;
    stop();
    draggingIndex.value = null;
    if (index !== null) options.onDrop?.(index);
  }

  function startDrag(event: PointerEvent | MouseEvent, index: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    draggingIndex.value = index;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  onBeforeUnmount(stop);

  return { draggingIndex, startDrag };
}
