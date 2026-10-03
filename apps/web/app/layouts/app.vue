<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from '#imports';

import AppBottomNav from '../components/app/AppBottomNav.vue';
import AppHeader from '../components/app/AppHeader.vue';
import AppMobileMenu from '../components/app/AppMobileMenu.vue';
import AppOperationDialogs from '../components/app/AppOperationDialogs.vue';
import AppSidebar from '../components/app/AppSidebar.vue';
import FundingEntryHost from '../components/funding/FundingEntryHost.vue';
import UiEmptyState from '../components/ui/EmptyState.vue';
import UiToastStack from '../components/ui/ToastStack.vue';
import { useAuth } from '../composables/useAuth.js';

defineOptions({ name: 'AppLayout' });

// The mobile menu has two entry points now — the burger in the header and
// "Ещё" in the bottom navigation — so the layout owns its state.
const mobileMenuOpen = ref(false);

// Only the Envelope Plan v2.2 model is supported. A budget that has not been
// moved to it yet (the one-time cutover is done by the operator) gets a single
// explanation instead of screens that would answer with model errors.
const { currentData } = useAuth();
const route = useRoute();
// Account-level screens (password, sessions) do not depend on the budget model.
const accountScreen = computed(() => route.path.startsWith('/app/settings/'));
const budgetNotMigrated = computed(() => {
  const budget = currentData.value?.workspaces[0]?.budgets[0];
  return !accountScreen.value && budget !== undefined && budget.planModelVersion !== 2;
});
</script>

<template>
  <div class="app-layout">
    <AppSidebar class="app-layout__sidebar" />
    <div class="app-layout__body">
      <AppHeader
        class="app-layout__header"
        @toggle-mobile-menu="mobileMenuOpen = !mobileMenuOpen"
      />
      <main class="app-layout__main">
        <UiEmptyState
          v-if="budgetNotMigrated"
          title="Бюджет ещё не переведён на новую модель"
          description="Обратитесь к владельцу или оператору: пока перевод не выполнен, экраны бюджета недоступны."
          data-testid="budget-not-migrated"
        />
        <slot v-else />
      </main>
    </div>

    <AppMobileMenu :open="mobileMenuOpen" @close="mobileMenuOpen = false" />
    <AppBottomNav @more="mobileMenuOpen = true" />
    <AppOperationDialogs />
    <FundingEntryHost />
    <UiToastStack />
  </div>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
  background: var(--hf-color-page-background);
}

.app-layout__sidebar {
  display: none;
}

.app-layout__main {
  padding: var(--hf-space-6) var(--hf-space-5);
  padding-bottom: calc(var(--hf-space-16) + env(safe-area-inset-bottom));
}

@media (min-width: 1024px) {
  .app-layout {
    display: grid;
    grid-template-columns: var(--hf-sidebar-width) 1fr;
  }

  .app-layout__sidebar {
    position: sticky;
    top: 0;
    display: flex;
    align-self: start;
  }

  .app-layout__header {
    display: none;
  }

  .app-layout__main {
    padding: var(--hf-space-8);
  }
}

@media (min-width: 768px) and (max-width: 1023px) {
  .app-layout__main {
    padding: var(--hf-space-8);
    padding-bottom: calc(var(--hf-space-16) + env(safe-area-inset-bottom));
  }
}
</style>
