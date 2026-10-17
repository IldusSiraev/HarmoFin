<script setup lang="ts">
import { ChevronRight } from '@lucide/vue';
import { computed } from 'vue';

import FinanceMoney from '../../finance/FinanceMoney.vue';
import { basisPointsPercent } from './chart-scale.js';

defineOptions({ name: 'AnalyticsShareBar' });

export type ShareItem = {
  id: string;
  label: string;
  amountMinor: string;
  shareBasisPoints: number;
  href?: string | undefined;
};

const props = withDefaults(defineProps<{ items: ReadonlyArray<ShareItem>; highlight?: number }>(), {
  highlight: 5,
});

const tone = (index: number) => (index < props.highlight ? String(index + 1) : 'rest');

// Segment x/width in viewBox units (0..10000 = server basis points), no browser measuring.
const segments = computed(() => {
  let x = 0;
  return props.items.map((item, index) => {
    const segment = { id: item.id, x, width: item.shareBasisPoints, tone: tone(index) };
    x += item.shareBasisPoints;
    return segment;
  });
});
</script>

<template>
  <div class="share-bar">
    <svg
      class="share-bar__track"
      viewBox="0 0 10000 1"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        v-for="segment in segments"
        :key="segment.id"
        data-segment
        :data-tone="segment.tone"
        :class="`share-bar__segment share-bar__segment--${segment.tone}`"
        :x="segment.x"
        y="0"
        :width="segment.width"
        height="1"
      />
    </svg>
    <ul class="share-bar__list">
      <li v-for="(item, index) in items" :key="item.id" data-share-row class="share-bar__row">
        <NuxtLink v-if="item.href" :to="item.href" class="share-bar__link">
          <span :class="`share-bar__dot share-bar__segment--${tone(index)}`" aria-hidden="true" />
          <span class="share-bar__label">{{ item.label }}</span>
          <FinanceMoney
            class="share-bar__amount"
            :minor-units="item.amountMinor"
            currency="RUB"
            :scale="2"
          />
          <span class="share-bar__share">{{ basisPointsPercent(item.shareBasisPoints) }}</span>
          <ChevronRight class="share-bar__chevron" :size="16" aria-hidden="true" />
        </NuxtLink>
        <div v-else class="share-bar__content">
          <span :class="`share-bar__dot share-bar__segment--${tone(index)}`" aria-hidden="true" />
          <span class="share-bar__label">{{ item.label }}</span>
          <FinanceMoney
            class="share-bar__amount"
            :minor-units="item.amountMinor"
            currency="RUB"
            :scale="2"
          />
          <span class="share-bar__share">{{ basisPointsPercent(item.shareBasisPoints) }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.share-bar {
  display: grid;
  gap: var(--hf-space-4);
}
.share-bar__track {
  display: block;
  width: 100%;
  height: 0.75rem;
  overflow: hidden;
  border-radius: var(--hf-radius-sm);
  background: var(--hf-color-chart-track);
}
.share-bar__segment--1 {
  fill: var(--hf-color-chart-1);
  background: var(--hf-color-chart-1);
}
.share-bar__segment--2 {
  fill: var(--hf-color-chart-2);
  background: var(--hf-color-chart-2);
}
.share-bar__segment--3 {
  fill: var(--hf-color-chart-3);
  background: var(--hf-color-chart-3);
}
.share-bar__segment--4 {
  fill: var(--hf-color-chart-4);
  background: var(--hf-color-chart-4);
}
.share-bar__segment--5 {
  fill: var(--hf-color-chart-5);
  background: var(--hf-color-chart-5);
}
.share-bar__segment--rest {
  fill: var(--hf-color-chart-rest);
  background: var(--hf-color-chart-rest);
}
.share-bar__list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.share-bar__row {
  display: block;
}
.share-bar__link,
.share-bar__content {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto 3.5rem auto;
  align-items: center;
  gap: var(--hf-space-3);
  min-height: var(--hf-control-height-sm);
}
.share-bar__link {
  color: inherit;
  text-decoration: none;
  border-radius: var(--hf-radius-sm);
}
.share-bar__link:hover .share-bar__label,
.share-bar__link:focus-visible .share-bar__label {
  text-decoration: underline;
}
.share-bar__link:focus-visible {
  box-shadow: var(--hf-focus-indicator);
  outline-offset: 2px;
}
.share-bar__dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
}
.share-bar__label {
  overflow: hidden;
  color: var(--hf-color-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.share-bar__link .share-bar__label {
  color: var(--hf-color-action-primary-text);
  font-weight: var(--hf-font-weight-medium);
}
.share-bar__amount,
.share-bar__share {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.share-bar__share {
  color: var(--hf-color-text-muted);
}
.share-bar__chevron {
  color: var(--hf-color-text-muted);
}
</style>
