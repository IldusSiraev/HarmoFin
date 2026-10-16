<script setup lang="ts">
defineOptions({ name: 'LandingShowcase' });

// A real app component rendered with demo data. `inert` disables clicks,
// focus and API calls inside; the visible caption carries the meaning for
// assistive technology, because inert content leaves the accessibility tree.
defineProps<{ caption: string }>();
</script>

<template>
  <figure class="landing-showcase">
    <div class="landing-showcase__frame" inert>
      <slot />
    </div>
    <figcaption class="landing-showcase__caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.landing-showcase {
  display: grid;
  gap: var(--hf-space-3);
  margin: 0;
  min-width: 0;
}

.landing-showcase__frame {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
  overflow: hidden;
  user-select: none;
}

.landing-showcase__caption {
  font-size: var(--hf-font-size-small);
  color: var(--hf-color-text-muted);
}
</style>
