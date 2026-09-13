<script setup lang="ts">
import { useRevealOnScroll } from '../../../composables/useRevealOnScroll.js';

defineOptions({ name: 'LandingSection' });

withDefaults(
  defineProps<{
    sectionId: string;
    title: string;
    eyebrow?: string | undefined;
    description?: string | undefined;
    tone?: 'default' | 'muted' | 'brand';
  }>(),
  { eyebrow: undefined, description: undefined, tone: 'default' },
);

const { target, revealed } = useRevealOnScroll();
</script>

<template>
  <section
    :id="sectionId"
    class="landing-section"
    :class="`landing-section--${tone}`"
    :aria-labelledby="`${sectionId}-title`"
  >
    <div ref="target" class="landing-section__inner" :class="{ 'is-revealed': revealed }">
      <header class="landing-section__header">
        <p v-if="eyebrow" class="landing-section__eyebrow">{{ eyebrow }}</p>
        <h2 :id="`${sectionId}-title`" class="landing-section__title">{{ title }}</h2>
        <p v-if="description" class="landing-section__description">{{ description }}</p>
      </header>
      <div class="landing-section__body">
        <slot />
      </div>
    </div>
  </section>
</template>

<style scoped>
.landing-section {
  padding: var(--hf-space-16) var(--hf-space-4);
  scroll-margin-top: 5rem;
}

.landing-section--muted {
  background: var(--hf-color-page-background);
}

.landing-section--brand {
  background: var(--hf-color-brand-soft);
}

.landing-section__inner {
  display: grid;
  gap: var(--hf-space-8);
  max-width: var(--hf-container-max);
  margin: 0 auto;
  opacity: 0;
  transform: translateY(12px) scale(0.98);
  transition:
    opacity 400ms ease-out,
    transform 400ms ease-out;
}

.landing-section__inner.is-revealed {
  opacity: 1;
  transform: none;
}

.landing-section__header {
  display: grid;
  gap: var(--hf-space-3);
  max-width: 44rem;
}

.landing-section__eyebrow {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.landing-section__title {
  margin: 0;
  font-size: var(--hf-font-size-h2);
  line-height: var(--hf-line-height-h2);
  font-weight: var(--hf-font-weight-semibold);
  letter-spacing: -0.01em;
}

.landing-section__description {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-body);
  line-height: var(--hf-line-height-body);
}

@media (min-width: 1024px) {
  .landing-section {
    padding: var(--hf-space-24) var(--hf-space-8);
  }
}
</style>
