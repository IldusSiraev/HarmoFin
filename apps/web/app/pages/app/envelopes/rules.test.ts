import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

enableAutoUnmount(afterEach);

const mocks = vi.hoisted(() => ({
  auth: { currentData: { value: null as unknown }, loadMe: vi.fn() },
  navigateTo: vi.fn(),
  leaveGuard: null as null | ((to: { fullPath: string }) => boolean | undefined),
}));

vi.mock('#imports', () => ({ definePageMeta: vi.fn(), navigateTo: mocks.navigateTo }));
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  onBeforeRouteLeave: (guard: (to: { fullPath: string }) => boolean | undefined) => {
    mocks.leaveGuard = guard;
  },
}));
vi.mock('../../../composables/useAuth.js', () => ({ useAuth: () => mocks.auth }));

const EditorStub = defineComponent({
  name: 'FundingRulesEditor',
  props: { budgetId: { type: String, required: true } },
  emits: ['dirty'],
  setup(props, { emit }) {
    return () =>
      h('button', {
        'data-testid': 'editor-stub',
        'data-budget': props.budgetId,
        onClick: () => emit('dirty', true),
      });
  },
});

import RulesPage from './rules.vue';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.leaveGuard = null;
  mocks.auth.currentData.value = { workspaces: [{ budgets: [{ id: 'budget-1' }] }] };
});

async function mountPage() {
  const wrapper = mount(RulesPage, {
    attachTo: document.body,
    global: {
      stubs: { FundingRulesEditor: EditorStub, NuxtLink: { template: '<a><slot /></a>' } },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('rules page', () => {
  it('передаёт бюджет редактору и ведёт назад к конвертам', async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-testid="editor-stub"]').attributes('data-budget')).toBe('budget-1');
    expect(wrapper.text()).toContain('Правила пополнения');
    expect(wrapper.text()).toContain('Назад к конвертам');
  });

  it('без изменений уход разрешён', async () => {
    await mountPage();
    expect(mocks.leaveGuard!({ fullPath: '/app' })).toBe(true);
  });

  it('с изменениями спрашивает подтверждение и уходит после него', async () => {
    const wrapper = await mountPage();
    await wrapper.find('[data-testid="editor-stub"]').trigger('click');
    expect(mocks.leaveGuard!({ fullPath: '/app' })).toBe(false);
    await flushPromises();
    expect(document.body.textContent).toContain('Есть несохранённые изменения');
    const confirm = document.querySelector<HTMLButtonElement>('[data-confirm]');
    confirm?.click();
    await flushPromises();
    expect(mocks.navigateTo).toHaveBeenCalledWith('/app');
    expect(mocks.leaveGuard!({ fullPath: '/app' })).toBe(true);
  });

  it('beforeunload предупреждает только при изменениях', async () => {
    const wrapper = await mountPage();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await wrapper.find('[data-testid="editor-stub"]').trigger('click');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});
