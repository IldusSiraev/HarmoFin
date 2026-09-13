<script setup lang="ts">
import { Check, Circle } from '@lucide/vue';

import LandingSection from '../ui/LandingSection.vue';
import { roadmapNext, roadmapNow } from '../../../data/landing.js';

defineOptions({ name: 'RoadmapSection' });
</script>

<template>
  <LandingSection
    section-id="roadmap"
    tone="muted"
    eyebrow="Развитие"
    title="Начинаем с простого. Растём вместе с вами."
  >
    <div class="roadmap__grid">
      <div class="roadmap__column" data-testid="roadmap-now">
        <h3 class="roadmap__heading">Сейчас</h3>
        <ul class="roadmap__list">
          <li v-for="item in roadmapNow" :key="item" class="roadmap__item">
            <Check :size="16" aria-hidden="true" />
            <span>{{ item }}</span>
          </li>
        </ul>
      </div>

      <div class="roadmap__column" data-testid="roadmap-next">
        <h3 class="roadmap__heading">Дальше</h3>
        <ul class="roadmap__list">
          <li v-for="item in roadmapNext" :key="item" class="roadmap__item roadmap__item--next">
            <Circle :size="16" aria-hidden="true" />
            <span>{{ item }}</span>
          </li>
        </ul>
      </div>
    </div>
  </LandingSection>
</template>

<style scoped>
.roadmap__grid {
  display: grid;
  gap: var(--hf-space-6);
}

@media (min-width: 768px) {
  .roadmap__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.roadmap__heading {
  margin: 0 0 var(--hf-space-3);
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
  font-weight: var(--hf-font-weight-semibold);
}

.roadmap__list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.roadmap__item {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  color: var(--hf-color-text);
}

.roadmap__item :deep(svg) {
  color: var(--hf-color-brand);
}

.roadmap__item--next :deep(svg) {
  color: var(--hf-color-text-muted);
}
</style>
