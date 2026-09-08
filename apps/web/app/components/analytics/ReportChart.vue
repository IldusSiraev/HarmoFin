<script setup lang="ts">
import * as echarts from 'echarts';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import type { ReportDto } from '../../composables/useBudgetReferenceData.js';
import ReportTable from './ReportTable.vue';

const props = defineProps<{ report: ReportDto }>();
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
  chart.setOption({
    animation: false,
    grid: { top: 16, right: 24, bottom: 32, left: 112 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: '#d8ddd9' } } },
    yAxis: { type: 'category', data: labels, axisLabel: { color: '#33403a' } },
    series: [
      {
        type: 'bar',
        data: amounts,
        itemStyle: { color: '#2f6e5a', borderRadius: [0, 4, 4, 0] },
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
