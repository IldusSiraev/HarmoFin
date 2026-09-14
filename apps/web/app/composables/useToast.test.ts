import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useToast } from './useToast.js';

beforeEach(() => {
  vi.useFakeTimers();
  useToast().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useToast', () => {
  it('shares one queue across call sites', () => {
    const producer = useToast();
    const consumer = useToast();

    producer.push({ tone: 'success', title: 'Операция сохранена' });

    expect(consumer.toasts.value).toHaveLength(1);
    expect(consumer.toasts.value[0]?.title).toBe('Операция сохранена');
    expect(consumer.toasts.value[0]?.tone).toBe('success');
  });

  it('keeps every pushed toast until it is dismissed', () => {
    const { toasts, push, dismiss } = useToast();

    const first = push({ tone: 'info', title: 'Первый' });
    push({ tone: 'error', title: 'Второй' });
    expect(toasts.value).toHaveLength(2);

    dismiss(first);

    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]?.title).toBe('Второй');
  });

  it('removes a toast once its lifetime elapses', () => {
    const { toasts, push } = useToast();

    push({ tone: 'success', title: 'Счёт создан' });
    expect(toasts.value).toHaveLength(1);

    vi.advanceTimersByTime(6000);

    expect(toasts.value).toHaveLength(0);
  });

  it('honours an explicit lifetime', () => {
    const { toasts, push } = useToast();

    push({ tone: 'error', title: 'Не удалось сохранить', durationMs: 12_000 });

    vi.advanceTimersByTime(6000);
    expect(toasts.value).toHaveLength(1);

    vi.advanceTimersByTime(6000);
    expect(toasts.value).toHaveLength(0);
  });

  it('stops the countdown while a toast is held and restarts it on release', () => {
    const { toasts, push, hold, release } = useToast();

    const id = push({ tone: 'info', title: 'Наведи на меня' });

    hold(id);
    vi.advanceTimersByTime(60_000);
    expect(toasts.value).toHaveLength(1);

    release(id);
    vi.advanceTimersByTime(6000);
    expect(toasts.value).toHaveLength(0);
  });

  it('gives every toast its own id', () => {
    const { push } = useToast();

    expect(push({ tone: 'info', title: 'Раз' })).not.toBe(push({ tone: 'info', title: 'Два' }));
  });
});
