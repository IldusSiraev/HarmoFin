<script setup lang="ts">
import { Plus } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

defineOptions({ name: 'AppAddMenu' });

withDefaults(
  defineProps<{
    tooltipPlacement?: 'top' | 'bottom';
  }>(),
  { tooltipPlacement: 'top' },
);

const { openChoose } = useOperationDialogs();
</script>

<template>
  <UiButton
    class="app-add-menu"
    variant="brand"
    aria-label="Добавить операцию или перевод"
    tooltip="Добавить операцию или перевод"
    :tooltip-placement="tooltipPlacement"
    data-testid="add-menu-trigger"
    @click="openChoose()"
  >
    <Plus :size="18" aria-hidden="true" />
  </UiButton>
</template>
