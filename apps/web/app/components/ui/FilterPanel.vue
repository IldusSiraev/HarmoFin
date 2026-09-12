<script setup lang="ts">
import { ref } from 'vue';

import UiButton from './Button.vue';

defineOptions({ name: 'FilterPanel' });

withDefaults(defineProps<{ activeCount?: number }>(), { activeCount: 0 });

const open = ref(false);

function toggle() {
  open.value = !open.value;
}

function close() {
  open.value = false;
}
</script>

<template>
  <div class="filter-panel">
    <div class="filter-panel__bar">
      <div class="filter-panel__quick"><slot name="quick" /></div>
      <div class="filter-panel__trigger" @keydown.esc="close">
        <UiButton type="button" variant="secondary" :aria-expanded="open" aria-haspopup="true" @click="toggle">
          Фильтры
          <span v-if="activeCount > 0" class="filter-panel__badge">{{
            activeCount
          }}</span>
        </UiButton>
        <Transition name="filter-panel-dropdown">
          <div v-if="open" class="filter-panel__dropdown">
            <div class="filter-panel__backdrop" @click="close" />
            <div
              class="filter-panel__panel"
              role="region"
              aria-label="Дополнительные фильтры"
            >
              <slot />
              <div class="filter-panel__panel-actions">
                <UiButton type="button" variant="tertiary" @click="close">Готово</UiButton>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filter-panel__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--hf-space-3);
}

.filter-panel__quick {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}

.filter-panel__trigger {
  position: relative;
}

.filter-panel__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  margin-left: var(--hf-space-2);
  padding: 0 var(--hf-space-1);
  border-radius: 999px;
  background: var(--hf-color-white);
  color: var(--hf-color-action-primary);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-bold);
}

.filter-panel__dropdown {
}

.filter-panel__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--hf-z-index-modal-backdrop, 200);
}

.filter-panel__panel {
  position: absolute;
  top: calc(100% + var(--hf-space-2));
  right: 0;
  display: grid;
  gap: var(--hf-space-4);
  width: min(90vw, 28rem);
  max-height: 70vh;
  padding: var(--hf-space-5);
  overflow-y: auto;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  box-shadow:
    0 4px 6px rgb(13 27 42 / 10%),
    0 2px 4px rgb(13 27 42 / 6%);
  z-index: var(--hf-z-index-modal-backdrop, 200);
}

.filter-panel__panel-actions {
  display: flex;
  justify-content: flex-end;
}

.filter-panel-dropdown-enter-active,
.filter-panel-dropdown-leave-active {
  transition: opacity var(--hf-transition-fast);
}

.filter-panel-dropdown-enter-from,
.filter-panel-dropdown-leave-to {
  opacity: 0;
}
</style>
