<script setup lang="ts">
defineOptions({ name: 'ReferencePageLayout' });
</script>

<template>
  <div class="reference-page-layout">
    <div class="reference-page-layout__header">
      <div>
        <p v-if="$slots.kicker" class="reference-page-layout__kicker"><slot name="kicker" /></p>
        <h1><slot name="title" /></h1>
        <p v-if="$slots.description" class="reference-page-layout__description">
          <slot name="description" />
        </p>
      </div>
      <div v-if="$slots.actions" class="reference-page-layout__actions">
        <slot name="actions" />
      </div>
    </div>
    <div v-if="$slots.filters" class="reference-page-layout__filters">
      <slot name="filters" />
    </div>
    <div class="reference-page-layout__content">
      <slot name="content" />
    </div>
  </div>
</template>

<style scoped>
.reference-page-layout {
  max-width: 70rem;
  margin: 0 auto;
  padding: var(--hf-space-8);
}

.reference-page-layout__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--hf-space-6);
}

.reference-page-layout__kicker {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-action-primary-hover);
  font-size: 0.875rem;
  font-weight: var(--hf-font-weight-semibold);
  text-transform: uppercase;
}

.reference-page-layout h1 {
  margin: 0;
  font-size: clamp(2rem, 5vw, 3.25rem);
  letter-spacing: -0.04em;
}

.reference-page-layout__description {
  margin: var(--hf-space-3) 0 0;
  color: var(--hf-color-text-muted);
}

.reference-page-layout__filters {
  max-width: 18rem;
  margin-top: var(--hf-space-6);
}

.reference-page-layout__content {
  margin-top: var(--hf-space-5);
}

@media (max-width: 47.9375rem) {
  .reference-page-layout {
    padding: var(--hf-space-5);
  }

  .reference-page-layout__header {
    align-items: stretch;
    flex-direction: column;
  }

  .reference-page-layout__header > :last-child {
    align-self: start;
  }
}
</style>
