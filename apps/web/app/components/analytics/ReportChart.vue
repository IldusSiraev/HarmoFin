<script setup lang="ts">
import * as echarts from 'echarts';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { GenericReportDto } from '../../composables/useBudgetReferenceData.js';
import ReportTable from './ReportTable.vue';

const props = defineProps<{ report: GenericReportDto }>();
const chartElement = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

function rowLabel(row: Record<string, unknown>) {
  return String(row.categoryName ?? row.name ?? row.cycleStart ?? row.periodStart ?? 'Показатель');
}

function rowAmount(row: Record<string, unknown>) {
  const value = Object.entries(row).find(
    ([key, candidate]) => key.endsWith('Minor') && typeof candidate === 'string',
  )?.[1];
  return typeof value === 'string' ? Number(value) : 0;
}

function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function renderChart() {
  if (
    !chartElement.value ||
    chartElement.value.clientWidth === 0 ||
    chartElement.value.clientHeight === 0 ||
    props.report.rows.length === 0
  )
    return;
  chart?.dispose();
  chart = echarts.init(chartElement.value);
  const labels = props.report.rows.map(rowLabel);
  const amounts = props.report.rows.map(rowAmount);
  const chartColors = {
    grid: readToken('--hf-color-border', '#e2e8f0'),
    axis: readToken('--hf-color-text-muted', '#64748b'),
    bar: readToken('--hf-color-brand', '#0a7f60'),
  };
  chart.setOption({
    animation: false,
    grid: { top: 16, right: 24, bottom: 32, left: 112 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: chartColors.grid } } },
    yAxis: { type: 'category', data: labels, axisLabel: { color: chartColors.axis } },
    series: [
      {
        type: 'bar',
        data: amounts,
        itemStyle: { color: chartColors.bar, borderRadius: [0, 4, 4, 0] },
      },
    ],
  });
}

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') renderChart();
});
watch(() => props.report, renderChart, { deep: true });
onBeforeUnmount(() => chart?.dispose());
</script>

<template>
  <section class="report-chart" :aria-label="`Визуализация отчёта ${report.key}`">
    <div
      v-if="report.rows.length > 0"
      ref="chartElement"
      class="report-chart__canvas"
      aria-hidden="true"
    />
    <ReportTable :rows="report.rows" />
  </section>
</template>

<style scoped>
.report-chart {
  display: grid;
  gap: var(--hf-space-5);
}
.report-chart__canvas {
  min-height: 20rem;
  background: var(--hf-color-surface);
}
</style>
