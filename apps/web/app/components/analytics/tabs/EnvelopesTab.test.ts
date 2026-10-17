import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const v2 = { getReport: vi.fn() };
vi.mock('../../../composables/useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => v2,
}));
const global = { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } };
const reply = (data: Record<string, unknown[]>) =>
  v2.getReport.mockImplementation(async (_budgetId: string, key: string) => ({
    key,
    rows: data[key] ?? [],
  }));

import { findSelect, selectOption } from '../../../test/select-option.js';
import EnvelopesTab from './EnvelopesTab.vue';

const limit = (periodId: string, start: string, end: string, isCurrent: boolean, name: string) => ({
  periodId,
  periodStart: start,
  periodEnd: end,
  isCurrent,
  envelopeId: `e-${name}`,
  envelopeName: name,
  targetMinor: '1000',
  targetStatus: 'CONFIRMED',
  spentMinor: '100',
  remainingMinor: '900',
  overspentMinor: '0',
  spentPermille: 100,
});

describe('EnvelopesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('по умолчанию текущий период; выбор периода фильтрует только показ', async () => {
    reply({
      'envelope-limits': [
        limit('p2', '2026-03-15', '2026-03-31', true, 'Продукты'),
        limit('p1', '2026-03-01', '2026-03-14', false, 'Кафе'),
      ],
      'assignment-movements': [],
    });
    const wrapper = mount(EnvelopesTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    expect(wrapper.text()).toContain('Продукты');
    expect(wrapper.text()).not.toContain('Кафе');
    expect(findSelect(wrapper, 'limitPeriod')?.textContent).toContain('15.03–31.03 (текущий)');
    await selectOption(wrapper, 'limitPeriod', '2026-03-01:2026-03-14');
    expect(wrapper.text()).toContain('Кафе');
    expect(wrapper.text()).not.toContain('Продукты');
    expect(v2.getReport).toHaveBeenCalledTimes(2);
  });

  it('нет конвертов на текущие траты — пустое состояние', async () => {
    reply({});
    const wrapper = mount(EnvelopesTab, { props: { budgetId: 'b', filters: {} }, global });
    await flushPromises();
    expect(wrapper.text()).toContain('Нет данных');
    expect(findSelect(wrapper, 'limitPeriod')).toBeNull();
  });
});
