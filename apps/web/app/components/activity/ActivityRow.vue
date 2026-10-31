<script setup lang="ts">
import { computed } from 'vue';
import { navigateTo } from '#imports';

import UiListRow from '../ui/ListRow.vue';
import UiStatus from '../ui/Status.vue';
import { formatMinorUnits } from '../finance/money-format.js';
import type { ActivityItem } from '../../composables/useActivityFeed.js';
import {
  activityHeadline,
  activityHref,
  activityIcon,
  activitySubtitle,
  activityTone,
  isStruck,
} from './activity-phrases.js';

defineOptions({ name: 'ActivityRow' });

const props = defineProps<{ item: ActivityItem; now: Date }>();

const headline = computed(() => activityHeadline(props.item));
const subtitle = computed(() => activitySubtitle(props.item, props.now));
const href = computed(() => activityHref(props.item));
const struck = computed(() => isStruck(props.item));
// Display only: the server sent minor units, the client formats them.
const amount = computed(() =>
  props.item.amountMinor === null
    ? null
    : formatMinorUnits(props.item.amountMinor, props.item.currency, 2),
);
const label = computed(() =>
  [
    headline.value,
    subtitle.value,
    amount.value,
    struck.value ? 'удалено' : null,
    props.item.isNew ? 'новое' : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('. '),
);

function open(): void {
  if (href.value) void navigateTo(href.value);
}
</script>

<template>
  <UiListRow
    :label="label"
    :leading-tone="activityTone(item)"
    :interactive="href !== null"
    :data-testid="`activity-row-${item.id}`"
    @select="open"
  >
    <template #leading>
      <component :is="activityIcon(item)" :size="18" aria-hidden="true" />
    </template>
    <span class="activity-row__headline">{{ headline }}</span>
    <span class="activity-row__subtitle">{{ subtitle }}</span>
    <template #trailing>
      <span class="activity-row__trailing">
        <UiStatus v-if="item.isNew" label="новое" tone="info" />
        <span
          v-if="amount"
          class="activity-row__amount"
          :class="{ 'activity-row__amount--struck': struck }"
          >{{ amount }}</span
        >
        <span v-if="struck" class="activity-row__deleted">удалено</span>
      </span>
    </template>
  </UiListRow>
</template>

<style scoped>
.activity-row__headline {
  display: block;
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-row__subtitle {
  display: block;
  overflow: hidden;
  color: var(--hf-color-text-muted);
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-row__trailing {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--hf-space-2);
  align-items: center;
  justify-content: flex-end;
}

.activity-row__amount {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.activity-row__amount--struck,
.activity-row__deleted {
  color: var(--hf-color-text-muted);
}

.activity-row__amount--struck {
  text-decoration: line-through;
}

.activity-row__deleted {
  font-size: 0.875rem;
}
</style>
