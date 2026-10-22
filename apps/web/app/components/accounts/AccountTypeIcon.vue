<script setup lang="ts">
import { computed } from 'vue';

import type { AccountType } from '../../composables/useBudgetReferenceData.js';
import { ACCOUNT_TYPE_ICONS, accountTone } from './account-type.js';

defineOptions({ name: 'AccountTypeIcon' });

const props = withDefaults(defineProps<{ accountType: AccountType; size?: 'sm' | 'md' }>(), {
  size: 'md',
});

const icon = computed(() => ACCOUNT_TYPE_ICONS[props.accountType]);
const tone = computed(() => accountTone(props.accountType));
</script>

<template>
  <span
    class="account-type-icon"
    :class="[`account-type-icon--${tone}`, `account-type-icon--${size}`]"
    aria-hidden="true"
  >
    <component :is="icon" :size="size === 'sm' ? 16 : 20" />
  </span>
</template>

<style scoped>
.account-type-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: var(--hf-radius-md);
}

.account-type-icon--md {
  width: 2.5rem;
  height: 2.5rem;
}

.account-type-icon--sm {
  width: 2.25rem;
  height: 2.25rem;
}

.account-type-icon--bank {
  background: var(--hf-color-account-bank-soft);
  color: var(--hf-color-account-bank);
}

.account-type-icon--card {
  background: var(--hf-color-account-card-soft);
  color: var(--hf-color-account-card);
}

.account-type-icon--cash {
  background: var(--hf-color-account-cash-soft);
  color: var(--hf-color-account-cash);
}
</style>
