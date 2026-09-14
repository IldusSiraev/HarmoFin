import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

import { prefersReducedMotion } from './useCountUp.js';

export function useRevealOnScroll(): {
  target: Ref<HTMLElement | null>;
  revealed: Ref<boolean>;
  animating: Ref<boolean>;
} {
  const target = ref<HTMLElement | null>(null);
  const revealed = ref(false);
  const animating = ref(false);
  let observer: IntersectionObserver | null = null;

  function reveal(): void {
    revealed.value = true;
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
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });

  return { target, revealed, animating };
}
