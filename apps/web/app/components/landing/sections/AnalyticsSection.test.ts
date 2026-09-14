import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import AnalyticsSection from './AnalyticsSection.vue';

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  Reflect.deleteProperty(window, 'IntersectionObserver');
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

// The section mounts its charts through defineAsyncComponent. Waiting for those
// imports to settle is what keeps them from resolving after Vitest has torn the
// environment down — an unhandled EnvironmentTeardownError that fails the run.
async function mountWithCharts(): Promise<VueWrapper> {
  const mounted = mount(AnalyticsSection, { attachTo: document.body });

  // Resolving them takes real time, not just microtasks: each chart module
  // pulls in its own imports through the test runner's loader, so the wait has
  // to yield to the event loop rather than only flushing promises.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await flushPromises();
    await mounted.vm.$nextTick();
    if (mounted.findAll('svg[role="img"]').length >= 2) break;
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  return mounted;
}

describe('AnalyticsSection', () => {
  it('presents the analytics promise from the brief', async () => {
    wrapper = await mountWithCharts();

    expect(wrapper.get('section').attributes('id')).toBe('analytics');
    expect(wrapper.get('h2').text()).toBe('Понимайте не только сегодня, но и всю картину.');
    expect(wrapper.text()).toContain(
      'Смотрите расходы по категориям, периодам, циклам, счетам и конвертам — и переходите от показателя к исходным операциям.',
    );
  });

  it('mounts its charts once the section is revealed', async () => {
    wrapper = await mountWithCharts();

    const charts = wrapper.findAll('svg[role="img"]');
    expect(charts.length).toBe(2);
    for (const chart of charts) {
      expect(chart.attributes('aria-label')).toBeTruthy();
    }
    expect(wrapper.findAll('[data-testid="plan-bar"]').length).toBe(3);
  });
});
