import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

import { prefersReducedMotion } from './useCountUp.js';

const FALLBACK_DELAY_MS = 2000;

export function useRevealOnScroll(): {
  target: Ref<HTMLElement | null>;
  revealed: Ref<boolean>;
  animating: Ref<boolean>;
} {
  const target = ref<HTMLElement | null>(null);
  const revealed = ref(false);
  const animating = ref(false);
  let observer: IntersectionObserver | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  function clearFallbackTimer(): void {
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  }

  function reveal(): void {
    revealed.value = true;
    clearFallbackTimer();
    observer?.disconnect();
    observer = null;
  }

  onMounted(() => {
    if (
      prefersReducedMotion() ||
      typeof window === 'undefined' ||
      typeof window.IntersectionObserver !== 'function' ||
      !target.value
    ) {
      revealed.value = true;
      return;
    }

    animating.value = true;

    observer = new window.IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          reveal();
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
    );

    observer.observe(target.value);

    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      reveal();
    }, FALLBACK_DELAY_MS);
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    clearFallbackTimer();
  });

  return { target, revealed, animating };
}
