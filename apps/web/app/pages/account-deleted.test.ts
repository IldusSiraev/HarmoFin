import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ query: { until: '2026-11-17T09:00:00.000Z' } as Record<string, unknown> }));
vi.mock('#app', () => ({ useRoute: () => route, navigateTo: vi.fn() }));

import AccountDeletedPage from './account-deleted.vue';

// AuthForm is auto-imported by Nuxt; unit tests stub it with the props the page passes.
const stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  AuthForm: {
    props: ['title', 'subtitle', 'submitLabel', 'onSubmit'],
    template: '<main><h1>{{ title }}</h1><p>{{ subtitle }}</p><slot name="footer" /></main>',
  },
};

describe('account deleted page', () => {
  it('shows the purge date and where the restore link went', () => {
    const wrapper = mount(AccountDeletedPage, { global: { stubs } });

    expect(wrapper.text()).toContain('17.11.2026');
    expect(wrapper.text()).toContain('письмо со ссылкой для отмены');
  });

  it('falls back to the 30-day wording without a valid date', () => {
    route.query = {};
    const wrapper = mount(AccountDeletedPage, { global: { stubs } });

    expect(wrapper.text()).toContain('через 30 дней');
  });
});
