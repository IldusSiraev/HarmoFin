<script setup lang="ts">
import { computed } from 'vue';

import { envelopeTone, planIcon } from './envelope-plan-kind.js';

defineOptions({ name: 'EnvelopeTypeIcon' });

const props = withDefaults(defineProps<{ envelopeType: string; size?: 'sm' | 'md' }>(), {
  size: 'md',
});

const icon = computed(() => planIcon({ envelopeType: props.envelopeType }));
const tone = computed(() => envelopeTone(props.envelopeType));
</script>

<template>
  <span
    class="envelope-type-icon"
    :class="[`envelope-type-icon--${tone}`, `envelope-type-icon--${size}`]"
    aria-hidden="true"
  >
    <component :is="icon" :size="size === 'sm' ? 16 : 20" />
  </span>
</template>

<style scoped>
.envelope-type-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: var(--hf-radius-md);
}

.envelope-type-icon--md {
  width: 2.5rem;
  height: 2.5rem;
}

.envelope-type-icon--sm {
  width: 2rem;
  height: 2rem;
}

.envelope-type-icon--current {
  background: var(--hf-color-envelope-current-soft);
  color: var(--hf-color-envelope-current);
}

.envelope-type-icon--mandatory {
  background: var(--hf-color-envelope-mandatory-soft);
  color: var(--hf-color-envelope-mandatory);
}

.envelope-type-icon--savings {
  background: var(--hf-color-envelope-savings-soft);
  color: var(--hf-color-envelope-savings);
}

.envelope-type-icon--reserve {
  background: var(--hf-color-envelope-reserve-soft);
  color: var(--hf-color-envelope-reserve);
}

.envelope-type-icon--custom {
  background: var(--hf-color-envelope-custom-soft);
  color: var(--hf-color-envelope-custom);
}
</style>
