<script setup lang="ts">
import { computed } from 'vue';
import { AlertOctagon, AlertTriangle, ArrowRight, Info } from '@lucide/vue';

defineOptions({ name: 'UiAttentionRow' });

const props = defineProps<{
  tone: 'info' | 'warning' | 'danger';
  title: string;
  description?: string | undefined;
  actionLabel?: string | undefined;
  actionTo?: string | undefined;
}>();
const emit = defineEmits<{ action: [] }>();

const icon = computed(
  () => ({ info: Info, warning: AlertTriangle, danger: AlertOctagon })[props.tone],
);
</script>

<template>
  <div class="ui-attention-row" :class="`ui-attention-row--${tone}`">
    <span class="ui-attention-row__icon" aria-hidden="true">
      <component :is="icon" :size="18" />
    </span>
    <div class="ui-attention-row__text">
      <p class="ui-attention-row__title">{{ title }}</p>
      <p v-if="description" class="ui-attention-row__description">{{ description }}</p>
    </div>
    <template v-if="actionLabel">
      <NuxtLink v-if="actionTo" :to="actionTo" class="ui-attention-row__action">
        {{ actionLabel }}
        <ArrowRight :size="16" aria-hidden="true" />
      </NuxtLink>
      <button v-else type="button" class="ui-attention-row__action" @click="emit('action')">
        {{ actionLabel }}
        <ArrowRight :size="16" aria-hidden="true" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.ui-attention-row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--tone-border);
  border-radius: var(--hf-radius-md);
  background: var(--tone-soft);
}

.ui-attention-row--info {
  --tone: var(--hf-color-status-info);
  --tone-soft: var(--hf-color-status-info-background);
  --tone-border: color-mix(in srgb, var(--hf-color-primary-strong) 28%, transparent);
}

.ui-attention-row--warning {
  --tone: var(--hf-color-status-warning);
  --tone-soft: var(--hf-color-status-warning-background);
  --tone-border: color-mix(in srgb, var(--hf-color-status-warning-bright) 40%, transparent);
}

.ui-attention-row--danger {
  --tone: var(--hf-color-text-danger);
  --tone-soft: var(--hf-color-status-danger-background);
  --tone-border: color-mix(in srgb, var(--hf-color-danger-strong) 32%, transparent);
}

.ui-attention-row__icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface);
  color: var(--tone);
}

.ui-attention-row__text {
  flex: 1 1 auto;
  min-width: 0;
}

.ui-attention-row__title {
  margin: 0;
  font-weight: var(--hf-font-weight-semibold);
  overflow-wrap: anywhere;
}

.ui-attention-row__description {
  margin: var(--hf-space-1) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.ui-attention-row__action {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--hf-space-1);
  min-height: 44px;
  padding: 0 var(--hf-space-2);
  border: 0;
  background: none;
  color: var(--tone);
  font: inherit;
  font-weight: var(--hf-font-weight-semibold);
  text-decoration: none;
  cursor: pointer;
}

.ui-attention-row__action:focus-visible {
  outline: 2px solid var(--hf-color-focus-ring);
  outline-offset: 2px;
  border-radius: var(--hf-radius-sm);
}
</style>
