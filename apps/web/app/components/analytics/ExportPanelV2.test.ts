import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const v2 = {
  exportTransactions: vi.fn(),
  exportAssignments: vi.fn(),
};

vi.mock('../../composables/useEnvelopePlanV2.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEnvelopePlanV2: () => v2,
}));

import { ApiRequestError } from '../../composables/useApiClient.js';
import ExportPanelV2 from './ExportPanelV2.vue';

describe('ExportPanelV2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  });

  it('offers owner CSV downloads through v2 methods only', async () => {
    v2.exportTransactions.mockResolvedValue(new Blob(['a']));
    v2.exportAssignments.mockResolvedValue(new Blob(['b']));
    const wrapper = mount(ExportPanelV2, { props: { budgetId: 'budget-id', isOwner: true } });

    await wrapper.get('[data-action="export-transactions"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-action="export-assignments"]').trigger('click');
    await flushPromises();

    expect(v2.exportTransactions).toHaveBeenCalledWith('budget-id');
    expect(v2.exportAssignments).toHaveBeenCalledWith('budget-id');
    expect(wrapper.text()).toContain('Скачать операции (CSV)');
    expect(wrapper.text()).toContain('Скачать распределения (CSV)');
  });

  it('hides exports from non-owners and explains why', async () => {
    const wrapper = mount(ExportPanelV2, { props: { budgetId: 'budget-id', isOwner: false } });

    expect(wrapper.find('[data-action="export-transactions"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Экспорт доступен только владельцу бюджета');
  });

  it('explains EXPORT_LIMIT_EXCEEDED in Russian', async () => {
    v2.exportTransactions.mockRejectedValue(
      new ApiRequestError(422, { code: 'EXPORT_LIMIT_EXCEEDED', detail: 'too many' } as never),
    );
    const wrapper = mount(ExportPanelV2, { props: { budgetId: 'budget-id', isOwner: true } });

    await wrapper.get('[data-action="export-transactions"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="export-error"]').text().replace(/\s/g, ' ')).toContain(
      '10 000',
    );
  });

  it('does not call exports for a non-owner', async () => {
    const wrapper = mount(ExportPanelV2, { props: { budgetId: 'budget-id', isOwner: false } });

    expect(wrapper.find('[data-action="export-assignments"]').exists()).toBe(false);
    expect(v2.exportTransactions).not.toHaveBeenCalled();
    expect(v2.exportAssignments).not.toHaveBeenCalled();
  });
});
