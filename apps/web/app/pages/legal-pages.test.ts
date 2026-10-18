import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

const state = vi.hoisted(() => ({ complete: true }));
const operator = {
  name: 'Иванов Иван Иванович',
  inn: '123456789012',
  email: 'privacy@harmofin.example',
  hostingProvider: 'Хостинг-провайдер',
  emailProvider: 'Почтовый сервис',
};

vi.mock('#imports', () => ({ useHead: vi.fn() }));
vi.mock('../composables/useLegal.js', () => ({
  useLegal: () => ({
    operator: computed(() => operator),
    operatorComplete: computed(() => state.complete),
    loadDocuments: vi.fn().mockResolvedValue([
      { document: 'TERMS', version: '2026-10-18', effectiveOn: '2026-10-18' },
      { document: 'PRIVACY_POLICY', version: '2026-10-18', effectiveOn: '2026-10-18' },
      { document: 'PD_CONSENT', version: '2026-10-18', effectiveOn: '2026-10-18' },
    ]),
  }),
}));

import ConsentPage from './consent.vue';
import PrivacyPage from './privacy.vue';
import TermsPage from './terms.vue';

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('legal pages', () => {
  it.each([
    [PrivacyPage, 'Политика обработки персональных данных'],
    [TermsPage, 'Пользовательское соглашение'],
    [ConsentPage, 'Согласие на обработку персональных данных'],
  ])('renders the title, the edition and the operator requisites', async (page, title) => {
    state.complete = true;
    const wrapper = mount(page, { global: { stubs } });
    await flushPromises();

    expect(wrapper.get('h1').text()).toBe(title);
    expect(wrapper.text()).toContain('Редакция 2026-10-18, действует с 18.10.2026');
    expect(wrapper.text()).toContain('Иванов Иван Иванович');
    expect(wrapper.text()).toContain('123456789012');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('warns when the operator requisites are incomplete', async () => {
    state.complete = false;
    const wrapper = mount(PrivacyPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('Реквизиты оператора не заполнены');
  });

  it('names the hosting and email providers in the policy', async () => {
    state.complete = true;
    const wrapper = mount(PrivacyPage, { global: { stubs } });
    await flushPromises();

    expect(wrapper.text()).toContain('Хостинг-провайдер');
    expect(wrapper.text()).toContain('Почтовый сервис');
    expect(wrapper.text()).toContain('не более 30 дней');
  });
});
