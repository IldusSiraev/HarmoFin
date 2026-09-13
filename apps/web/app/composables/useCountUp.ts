import { getCurrentInstance, onBeforeUnmount, ref, type Ref } from 'vue';

const DEFAULT_DURATION_MS = 600;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useCountUp(
  targetValue: number,
  options: { durationMs?: number } = {},
): { value: Ref<number>; start: () => void } {
  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
  const value = ref(0);
  let started = false;
  let frameId: number | null = null;

  function cancel(): void {
    if (
      frameId !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(frameId);
    }
    frameId = null;
  }

  function start(): void {
    if (started) return;
    started = true;

    if (prefersReducedMotion() || typeof window === 'undefined') {
      value.value = targetValue;
      return;
    }

    let startedAt: number | null = null;

    const step = (timestamp: number): void => {
      if (startedAt === null) startedAt = timestamp;
      const elapsed = timestamp - startedAt;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - (1 - progress) ** 3;
      value.value = progress === 1 ? targetValue : Math.round(targetValue * eased);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(step);
      } else {
        frameId = null;
      }
    };

    frameId = window.requestAnimationFrame(step);
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(cancel);
  }

  return { value, start };
}
