import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/AddOperationModal.vue', () => ({
  default: {
    name: 'AddOperationModal',
    props: ['open'],
    emits: ['close', 'submit'],
    template:
      '<div v-if="open" data-testid="operation-modal"><button data-testid="operation-saved" @click="$emit(\'submit\')"></button></div>',
  },
}));

vi.mock('../dashboard/AddTransferModal.vue', () => ({
  default: {
    name: 'AddTransferModal',
    props: ['open'],
    emits: ['close', 'submit'],
    template: '<div v-if="open" data-testid="transfer-modal"></div>',
  },
}));

import AppOperationDialogs from './AppOperationDialogs.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';
import { useToast } from '../../composables/useToast.js';

beforeEach(() => {
  useOperationDialogs().close();
  useToast().clear();
});

describe('AppOperationDialogs', () => {
  it('shows nothing while no dialog is requested', () => {
    const wrapper = mount(AppOperationDialogs);

    expect(wrapper.find('[data-testid="operation-modal"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="transfer-modal"]').exists()).toBe(false);
  });

  it('opens the requested dialog', async () => {
    const wrapper = mount(AppOperationDialogs);

    useOperationDialogs().openTransfer();
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="transfer-modal"]')).toBeTruthy();
  });

  it('reports a save, closes the dialog and announces it', async () => {
    const wrapper = mount(AppOperationDialogs);
    useOperationDialogs().openOperation();
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-testid="operation-saved"]').trigger('click');

    expect(wrapper.emitted('saved')).toHaveLength(1);
    expect(useOperationDialogs().openDialog.value).toBe('none');
    expect(useToast().toasts.value[0]?.title).toBe('Операция сохранена');
  });
});
