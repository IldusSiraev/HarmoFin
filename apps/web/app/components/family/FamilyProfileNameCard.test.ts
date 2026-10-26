import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const currentUser = ref<{ id: string; email: string; displayName: string | null } | null>(null);
const updateProfile = vi.fn();

vi.mock('../../composables/useAuth.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAuth: () => ({ currentUser, updateProfile }),
}));

import FamilyProfileNameCard from './FamilyProfileNameCard.vue';

describe('FamilyProfileNameCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser.value = { id: 'u1', email: 'a@b.test', displayName: null };
  });

  it('asks to provide the name participants will see', () => {
    const wrapper = mount(FamilyProfileNameCard);
    expect(wrapper.text()).toContain('Укажите ваше имя — его увидят участники');
  });

  it('saves the trimmed display name', async () => {
    updateProfile.mockResolvedValue(undefined);
    const wrapper = mount(FamilyProfileNameCard);

    await wrapper.get('input[name="displayName"]').setValue('  Алия  ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(updateProfile).toHaveBeenCalledWith('Алия');
    expect(wrapper.text()).toContain('Имя сохранено.');
  });

  it('shows a field error on failure', async () => {
    updateProfile.mockRejectedValue(new Error('fail'));
    const wrapper = mount(FamilyProfileNameCard);

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Не удалось выполнить запрос. Повторите попытку.');
  });
});
