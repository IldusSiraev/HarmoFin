import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

const mocks = vi.hoisted(() => ({
  route: { query: {} as Record<string, string> },
  replace: vi.fn(),
  apiRequest: vi.fn(),
}));

// '#app' and '#imports' resolve to the same aliased module in this repo's vitest config, so both
// mocks must expose every export the page uses, regardless of which specifier it imports from.
vi.mock('#app', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ replace: mocks.replace }),
  useHead: vi.fn(),
}));
vi.mock('#imports', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ replace: mocks.replace }),
  useHead: vi.fn(),
}));
vi.mock('../composables/useApiClient.js', () => ({
  useApiClient: () => ({ request: mocks.apiRequest }),
}));

import DemoPage from './demo.vue';

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

function mountPage(query: Record<string, string> = {}) {
  mocks.route = reactive({ query }) as never;
  mocks.replace.mockImplementation(({ query: next }: { query: Record<string, string> }) => {
    mocks.route.query = next;
    return Promise.resolve();
  });
  return mount(DemoPage, { global: { stubs } });
}

describe('demo page', () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.apiRequest.mockReset();
  });

  it('starts with the cycle step and a demo notice, without any API call', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('Демо: выдуманная семья и суммы. Ничего не сохраняется.');
    expect(wrapper.get('h2').text()).toBe('Настройте финансовый цикл');
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it('moves forward and writes the step to the URL', async () => {
    const wrapper = mountPage();
    await wrapper.get('[data-action="demo-next"]').trigger('click');
    expect(mocks.replace).toHaveBeenLastCalledWith({
      query: { step: '1', start: '10', offset: '15' },
    });
  });

  it('blocks «Далее» on a choice step until a choice is made, then records it', async () => {
    const wrapper = mountPage({ step: '2' });
    await flushPromises();
    expect(wrapper.get('[data-action="demo-next"]').attributes('disabled')).toBeDefined();
    await wrapper.findAll('[role="group"] button')[1]!.trigger('click');
    expect(mocks.replace).toHaveBeenLastCalledWith({
      query: { step: '2', start: '10', offset: '15', split: 'vacation' },
    });
  });

  it('blocks «Далее» on step 0 while the cycle is invalid', async () => {
    const wrapper = mountPage({ step: '0', start: '10', offset: '15' });
    await wrapper.get('[name="demo-cycle-start"]').setValue('40');
    expect(wrapper.get('[data-action="demo-next"]').attributes('disabled')).toBeDefined();
  });

  it('keeps the stage preview on the last valid cycle while typing an invalid start', async () => {
    const wrapper = mountPage({ step: '0', start: '10', offset: '15' });
    await wrapper.get('[name="demo-cycle-start"]').setValue('40');
    expect(wrapper.findComponent({ name: 'SettingsCyclePreview' }).props('cycleStartDay')).toBe(10);
  });

  it('rewinds a URL without the needed choice and normalizes bad values', async () => {
    mountPage({ step: '5', start: '99' });
    await flushPromises();
    expect(mocks.replace).toHaveBeenCalledWith({ query: { step: '2', start: '10', offset: '15' } });
  });

  it('shows the visitor cycle dates in the scenario text', async () => {
    const wrapper = mountPage({ step: '3', start: '5', offset: '10', split: 'suggested' });
    await flushPromises();
    expect(wrapper.text()).toContain('9 октября');
  });

  it('offers registration as the main action on the final step and can restart', async () => {
    const wrapper = mountPage({ step: '6', split: 'suggested', leftover: 'save' });
    await flushPromises();
    const cta = wrapper.get('[data-action="demo-register"]');
    expect(cta.attributes('href')).toBe('/register');
    await wrapper.get('[data-action="demo-restart"]').trigger('click');
    expect(mocks.replace).toHaveBeenLastCalledWith({
      query: { step: '0', start: '10', offset: '15' },
    });
  });
});
