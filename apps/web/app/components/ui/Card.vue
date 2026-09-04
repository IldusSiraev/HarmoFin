<script setup lang="ts">
defineOptions({ name: 'UiCard' });

withDefaults(
  defineProps<{
    as?: 'div' | 'section' | 'article';
    tone?: 'default' | 'subtle';
  }>(),
  {
    as: 'div',
    tone: 'default',
  },
);
</script>

<template>
  <component :is="as" class="ui-card" :class="`ui-card--${tone}`">
    <header v-if="$slots.header" class="ui-card__header"><slot name="header" /></header>
    <div class="ui-card__content"><slot /></div>
    <div v-if="$slots.actions" class="ui-card__actions"><slot name="actions" /></div>
    <footer v-if="$slots.footer" class="ui-card__footer"><slot name="footer" /></footer>
  </component>
</template>

<style scoped>
.ui-card {
  overflow: hidden;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}

.ui-card--subtle {
  background: var(--hf-color-surface-subtle);
  box-shadow: none;
}

.ui-card__header,
.ui-card__content,
.ui-card__actions,
.ui-card__footer {
  padding: var(--hf-card-padding);
}

.ui-card__header,
.ui-card__actions,
.ui-card__footer {
  border-color: var(--hf-color-border);
}

.ui-card__header {
  border-bottom: 1px solid var(--hf-color-border);
}

.ui-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  border-top: 1px solid var(--hf-color-border);
}

.ui-card__footer {
  border-top: 1px solid var(--hf-color-border);
}
</style>
