import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UiToastStack from './ToastStack.vue';
import { useToast } from '../../composables/useToast.js';

beforeEach(() => {
  vi.useFakeTimers();
  useToast().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UiToastStack', () => {
  it('announces toasts politely without stealing focus', async () => {
    const wrapper = mount(UiToastStack);
    useToast().push({ tone: 'success', title: 'Операция сохранена', description: '2 450 ₽' });
    await wrapper.vm.$nextTick();

    const region = wrapper.get('[data-testid="toast-stack"]');
    expect(region.attributes('role')).toBe('status');
    expect(region.attributes('aria-live')).toBe('polite');
    expect(wrapper.text()).toContain('Операция сохранена');
    expect(wrapper.text()).toContain('2 450 ₽');
  });

  it('renders several toasts at once', async () => {
    const wrapper = mount(UiToastStack);
    const { push } = useToast();
    push({ tone: 'info', title: 'Первый' });
    push({ tone: 'error', title: 'Второй' });
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('[data-testid="toast"]')).toHaveLength(2);
  });

  it('dismisses a toast from its close button', async () => {
    const wrapper = mount(UiToastStack);
    useToast().push({ tone: 'info', title: 'Закрой меня' });
    await wrapper.vm.$nextTick();

    const close = wrapper.get('[data-testid="toast-dismiss"]');
    expect(close.attributes('aria-label')).toBe('Закрыть уведомление');

    await close.trigger('click');

    expect(wrapper.findAll('[data-testid="toast"]')).toHaveLength(0);
  });

  it('marks the tone in text, not only in colour', async () => {
    const wrapper = mount(UiToastStack);
    useToast().push({ tone: 'error', title: 'Не удалось сохранить' });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="toast"]').text()).toContain('Ошибка');
  });
});
