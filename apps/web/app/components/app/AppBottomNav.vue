<script setup lang="ts">
import { House, Menu, Plus, Receipt } from '@lucide/vue';

import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { usePermissions } from '../../composables/usePermissions.js';

defineOptions({ name: 'AppBottomNav' });

defineEmits<{ more: [] }>();

const { openOperation } = useOperationDialogs();
// A viewer cannot record operations: the server would reject it, so the
// central "+" is not offered at all.
const { canWrite } = usePermissions();
</script>

<template>
  <nav
    class="app-bottom-nav"
    :class="{ 'app-bottom-nav--no-add': !canWrite }"
    aria-label="Основные разделы"
  >
    <NuxtLink to="/app" class="app-bottom-nav__item">
      <House :size="20" aria-hidden="true" />
      <span>Главная</span>
    </NuxtLink>

    <NuxtLink to="/app/operations" class="app-bottom-nav__item">
      <Receipt :size="20" aria-hidden="true" />
      <span>Операции</span>
    </NuxtLink>

    <button
      v-if="canWrite"
      type="button"
      class="app-bottom-nav__add"
      data-testid="bottom-nav-add"
      aria-label="Добавить операцию"
      @click="openOperation()"
    >
      <Plus :size="24" aria-hidden="true" />
    </button>

    <button
      type="button"
      class="app-bottom-nav__item"
      data-testid="bottom-nav-more"
      @click="$emit('more')"
    >
      <Menu :size="20" aria-hidden="true" />
      <span>Ещё</span>
    </button>
  </nav>
</template>

<style scoped>
.app-bottom-nav {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 95;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: center;
  padding: var(--hf-space-2) var(--hf-space-2) calc(var(--hf-space-2) + env(safe-area-inset-bottom));
  border-top: 1px solid var(--hf-color-border);
  background: var(--hf-color-surface);
}

/* A viewer has no "+": three columns keep "Ещё" at the right edge instead of
   leaving a hole where the add button used to be. Only the column count
   changes here; surface, border and safe-area padding stay on the base rule. */
.app-bottom-nav--no-add {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.app-bottom-nav__item {
  display: grid;
  gap: var(--hf-space-1);
  justify-items: center;
  min-height: 2.75rem;
  border: 0;
  background: transparent;
  color: var(--hf-color-text-muted);
  font-family: inherit;
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
  text-decoration: none;
  cursor: pointer;
}

.app-bottom-nav__item:focus-visible,
.app-bottom-nav__add:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: -2px;
}

.app-bottom-nav__item.router-link-active {
  color: var(--hf-color-action-primary);
}

.app-bottom-nav__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.25rem;
  height: 3.25rem;
  justify-self: center;
  border: 0;
  border-radius: 50%;
  background: var(--hf-color-action-brand);
  color: var(--hf-color-white);
  box-shadow: var(--hf-shadow-md);
  cursor: pointer;
}

@media (min-width: 1024px) {
  .app-bottom-nav {
    display: none;
  }
}
</style>
