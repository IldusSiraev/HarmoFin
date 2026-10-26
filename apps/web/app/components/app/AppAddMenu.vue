<script setup lang="ts">
import { Plus } from '@lucide/vue';

import UiButton from '../ui/Button.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { usePermissions } from '../../composables/usePermissions.js';

defineOptions({ name: 'AppAddMenu' });

withDefaults(
  defineProps<{
    tooltipPlacement?: 'top' | 'bottom';
  }>(),
  { tooltipPlacement: 'top' },
);

const { openChoose } = useOperationDialogs();
// Recording an operation needs OWNER or EDITOR; a viewer never sees the server
// reject the attempt because the trigger is not shown at all.
const { canWrite } = usePermissions();
</script>

<template>
  <UiButton
    v-if="canWrite"
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
