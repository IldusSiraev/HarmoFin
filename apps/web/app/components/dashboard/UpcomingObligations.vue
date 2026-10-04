<script setup lang="ts">
import type { DashboardV2Response } from '../../composables/useEnvelopePlanV2.js';
import FinanceMoney from '../finance/FinanceMoney.vue';
import UiMoreLink from '../ui/MoreLink.vue';

defineProps<{
  items: DashboardV2Response['nearestObligations'];
}>();

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

function formatScheduledOn(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return dateFormatter.format(new Date(year, month - 1, day));
}
</script>

<template>
  <section class="upcoming-obligations" aria-labelledby="upcoming-obligations-title">
    <header class="upcoming-obligations__header">
      <h2 id="upcoming-obligations-title" class="upcoming-obligations__title">Обязательства</h2>
      <UiMoreLink to="/app/plans" aria-label="Все: Обязательства">Все</UiMoreLink>
    </header>
    <p v-if="items.length === 0" class="upcoming-obligations__empty">Ближайших обязательств нет.</p>
    <ul v-else>
      <li v-for="item in items" :key="item.occurrenceId">
        <p class="upcoming-obligations__date">{{ formatScheduledOn(item.scheduledOn) }}</p>
        <div class="upcoming-obligations__row">
          <span class="upcoming-obligations__name" :title="item.name">{{ item.name }}</span>
          <FinanceMoney :minor-units="item.unpaidMinor" currency="RUB" :scale="2" />
        </div>
        <UiMoreLink
          class="upcoming-obligations__link"
          :to="`/app/plans?occurrence=${item.occurrenceId}`"
          :aria-label="`Открыть план: ${item.name}, ${formatScheduledOn(item.scheduledOn)}`"
          >Открыть план</UiMoreLink
        >
      </li>
    </ul>
  </section>
</template>

<style scoped>
.upcoming-obligations {
  display: grid;
  align-content: start;
  gap: var(--hf-space-4);
  padding: var(--hf-card-padding);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.upcoming-obligations h2,
.upcoming-obligations p,
.upcoming-obligations ul {
  margin: 0;
}
.upcoming-obligations__header {
  display: flex;
  gap: var(--hf-space-3);
  align-items: center;
  justify-content: space-between;
}
.upcoming-obligations__title {
  color: var(--hf-color-text-muted);
  font-size: 0.75rem;
  font-weight: var(--hf-font-weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.upcoming-obligations ul {
  display: grid;
  gap: var(--hf-space-3);
  padding: 0;
  list-style: none;
}
.upcoming-obligations li {
  display: grid;
  gap: var(--hf-space-1);
  padding-top: var(--hf-space-3);
  border-top: 1px solid var(--hf-color-border);
}
.upcoming-obligations__date,
.upcoming-obligations__empty {
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  line-height: var(--hf-line-height-caption);
}
.upcoming-obligations__row {
  display: flex;
  gap: var(--hf-space-3);
  align-items: baseline;
  justify-content: space-between;
}
.upcoming-obligations__name {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upcoming-obligations__link {
  justify-self: start;
  min-height: 2.75rem;
}
</style>
