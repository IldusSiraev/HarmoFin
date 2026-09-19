import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import AppAddMenu from './AppAddMenu.vue';
import { useOperationDialogs } from '../../composables/useOperationDialogs.js';

beforeEach(() => {
  useOperationDialogs().close();
});

describe('AppAddMenu', () => {
  it('opens the type picker when the trigger is clicked', async () => {
    const wrapper = mount(AppAddMenu);

    expect(useOperationDialogs().openDialog.value).toBe('none');
    await wrapper.get('[data-testid="add-menu-trigger"]').trigger('click');

    expect(useOperationDialogs().openDialog.value).toBe('choose');
  });
});
