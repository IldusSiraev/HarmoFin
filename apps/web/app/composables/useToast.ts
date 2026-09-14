import { readonly, ref, type Ref } from 'vue';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastInput {
  tone: ToastTone;
  title: string;
  description?: string;
  durationMs?: number;
}

export interface ToastItem extends ToastInput {
  id: string;
}

const DEFAULT_DURATION_MS = 6000;

// Module-level state on purpose: a form deep in a page pushes a toast that a
// container mounted in the layout renders. Both call useToast().
const items = ref<ToastItem[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let nextId = 0;

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function dismiss(id: string): void {
  clearTimer(id);
  items.value = items.value.filter((item) => item.id !== id);
}

function push(input: ToastInput): string {
  nextId += 1;
  const id = `toast-${nextId}`;
  items.value = [...items.value, { ...input, id }];
  timers.set(
    id,
    setTimeout(() => {
      dismiss(id);
    }, input.durationMs ?? DEFAULT_DURATION_MS),
  );
  return id;
}

function clear(): void {
  for (const id of [...timers.keys()]) clearTimer(id);
  items.value = [];
}

export function useToast(): {
  toasts: Readonly<Ref<ToastItem[]>>;
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
} {
  return { toasts: readonly(items) as Readonly<Ref<ToastItem[]>>, push, dismiss, clear };
}
