import { ref, shallowRef } from 'vue';

import {
  type ReportV2Filters,
  type ReportV2Key,
  type ReportV2RowMap,
  useEnvelopePlanV2,
} from './useEnvelopePlanV2.js';

/** One report of the analytics page: server rows as-is, plus loading and error state. */
export function useAnalyticsReport<K extends ReportV2Key>(key: K) {
  const v2 = useEnvelopePlanV2();
  const rows = shallowRef<ReportV2RowMap[K][]>([]);
  // Starts true: the tab's first render (and SSR) must show a loading
  // skeleton, not an empty state, before the mounted load() call resolves.
  const loading = ref(true);
  const error = ref('');
  let request = 0;

  async function load(budgetId: string, filters: ReportV2Filters = {}) {
    const current = ++request;
    loading.value = true;
    error.value = '';
    try {
      const response = await v2.getReport(budgetId, key, filters);
      if (current !== request) return;
      rows.value = response.rows as unknown as ReportV2RowMap[K][];
    } catch {
      if (current !== request) return;
      rows.value = [];
      error.value = 'Не удалось загрузить отчёт.';
    } finally {
      if (current === request) loading.value = false;
    }
  }

  return { rows, loading, error, load };
}
