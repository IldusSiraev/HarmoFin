<script setup lang="ts">
defineOptions({ name: 'LandingFeatureCard' });
defineProps<{
  title: string;
  description: string;
  icon: 'envelope' | 'cycle' | 'control';
}>();
</script>

<template>
  <article class="feature-card">
    <div class="feature-card__icon" :data-icon="icon">
      <div v-if="icon === 'envelope'" class="icon-envelope"></div>
      <div v-else-if="icon === 'cycle'" class="icon-cycle"></div>
      <div v-else class="icon-control"></div>
    </div>
    <h3 class="feature-card__title">{{ title }}</h3>
    <p class="feature-card__description">{{ description }}</p>
  </article>
</template>

<style scoped>
.feature-card {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-space-6);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
  transition:
    transform var(--hf-transition-fast),
    box-shadow var(--hf-transition-fast);
}

.feature-card:hover {
  transform: translateY(-2px);
  box-shadow:
    0 4px 6px rgb(13 27 42 / 10%),
    0 2px 4px rgb(13 27 42 / 6%);
}

.feature-card__icon {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
}

.icon-envelope,
.icon-cycle,
.icon-control {
  position: relative;
  width: 1.5rem;
  height: 1.5rem;
}

.icon-envelope::before {
  position: absolute;
  inset: 0;
  border: 2px solid var(--hf-color-action-primary);
  border-radius: 2px;
  content: '';
}

.icon-envelope::after {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 50%;
  border-bottom: 2px solid var(--hf-color-action-primary);
  clip-path: polygon(0 0, 50% 50%, 100% 0);
  content: '';
}

.icon-cycle {
  border: 2px solid var(--hf-color-brand);
  border-radius: 50%;
  border-right-color: transparent;
  animation: spin 2s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.icon-control::before {
  position: absolute;
  top: 0.25rem;
  left: 0;
  width: 100%;
  height: 0.25rem;
  border-radius: 2px;
  background: var(--hf-color-action-primary);
  content: '';
}

.icon-control::after {
  position: absolute;
  bottom: 0.25rem;
  left: 0;
  width: 100%;
  height: 0.25rem;
  border-radius: 2px;
  background: var(--hf-color-action-primary);
  content: '';
}

.icon-control {
  border-left: 0.25rem solid var(--hf-color-action-primary);
  border-right: 0.25rem solid var(--hf-color-action-primary);
}

.feature-card__title {
  margin: 0;
  color: var(--hf-color-text);
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.feature-card__description {
  margin: 0;
  color: var(--hf-color-text-muted);
  line-height: 1.6;
}

@media (prefers-reduced-motion: reduce) {
  .icon-cycle {
    animation: none;
  }

  .feature-card:hover {
    transform: none;
  }
}
</style>
