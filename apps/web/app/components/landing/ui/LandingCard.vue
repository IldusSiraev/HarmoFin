<script setup lang="ts">
defineOptions({ name: 'LandingCard' });

withDefaults(defineProps<{ title?: string | undefined }>(), { title: undefined });
</script>

<template>
  <article class="landing-card">
    <div v-if="$slots.icon" class="landing-card__icon" aria-hidden="true">
      <slot name="icon" />
    </div>
    <h3 v-if="title" class="landing-card__title">{{ title }}</h3>
    <div class="landing-card__body">
      <slot />
    </div>
  </article>
</template>

<style scoped>
.landing-card {
  display: grid;
  gap: var(--hf-space-3);
  align-content: start;
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
}

.landing-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-primary-soft);
  color: var(--hf-color-action-primary);
}

.landing-card__title {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
  font-weight: var(--hf-font-weight-semibold);
}

.landing-card__body {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}
</style>
