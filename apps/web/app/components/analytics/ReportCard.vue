<script setup lang="ts">
import UiButton from '../ui/Button.vue';
import UiEmptyState from '../ui/EmptyState.vue';
import UiSkeleton from '../ui/Skeleton.vue';

defineOptions({ name: 'AnalyticsReportCard' });

withDefaults(
  defineProps<{
    title: string;
    loading: boolean;
    error: string;
    empty: boolean;
    emptyText?: string;
  }>(),
  { emptyText: 'Измените фильтры или добавьте подтверждённые операции.' },
);
defineEmits<{ retry: [] }>();
</script>

<template>
  <section class="report-card">
    <header class="report-card__head">
      <h2 class="report-card__title">{{ title }}</h2>
      <slot name="actions" />
    </header>
    <UiSkeleton v-if="loading" variant="card" />
    <p v-else-if="error" role="alert" class="report-card__error">
      {{ error }} <UiButton variant="tertiary" @click="$emit('retry')">Повторить</UiButton>
    </p>
    <UiEmptyState v-else-if="empty" title="Нет данных" :description="emptyText" />
    <slot v-else />
  </section>
</template>

<style scoped>
.report-card {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-space-5);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}
.report-card__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
  align-items: center;
  justify-content: space-between;
}
.report-card__title {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
}
.report-card__error {
  margin: 0;
  color: var(--hf-color-text-danger);
}
</style>
