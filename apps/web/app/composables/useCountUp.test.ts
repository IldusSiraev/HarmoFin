import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCountUp } from './useCountUp.js';

type Frame = (timestamp: number) => void;

function mockReducedMotion(reduce: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function mockFrames(): { frames: Frame[]; cancel: ReturnType<typeof vi.fn> } {
  const frames: Frame[] = [];
  const cancel = vi.fn();
  window.requestAnimationFrame = ((callback: Frame) => {
    frames.push(callback);
    return frames.length;
  }) as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = cancel as unknown as typeof window.cancelAnimationFrame;
  return { frames, cancel };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCountUp', () => {
  it('animates from zero to the target value', () => {
    mockReducedMotion(false);
    const { frames } = mockFrames();
    const { value, start } = useCountUp(1000, { durationMs: 600 });

    expect(value.value).toBe(0);
    start();

    frames[0]?.(0);
    frames[1]?.(300);
    expect(value.value).toBeGreaterThan(0);
    expect(value.value).toBeLessThan(1000);

    frames[2]?.(600);
    expect(value.value).toBe(1000);
  });

  it('jumps straight to the target when the document is hidden', () => {
    mockReducedMotion(false);
    const { frames } = mockFrames();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const { value, start } = useCountUp(1000);

    start();

    expect(value.value).toBe(1000);
    expect(frames).toHaveLength(0);
    hidden.mockRestore();
  });

  it('jumps straight to the target when reduced motion is requested', () => {
    mockReducedMotion(true);
    const { frames } = mockFrames();
    const { value, start } = useCountUp(1000);

    start();

    expect(value.value).toBe(1000);
    expect(frames).toHaveLength(0);
  });

  it('ignores repeated start calls once finished', () => {
    mockReducedMotion(false);
    const { frames } = mockFrames();
    const { value, start } = useCountUp(500, { durationMs: 600 });

    start();
    start();

    expect(frames).toHaveLength(1);

    frames[0]?.(0);
    frames[1]?.(600);

    expect(value.value).toBe(500);
  });

  it('cancels the pending animation frame when the host component unmounts', () => {
    mockReducedMotion(false);
    const { frames, cancel } = mockFrames();

    const Host = defineComponent({
      name: 'CountUpHost',
      setup() {
        const { value, start } = useCountUp(1000, { durationMs: 600 });
        start();
        return () => h('div', String(value.value));
      },
    });

    const wrapper = mount(Host);

    frames[0]?.(0);
    const queuedFrameCount = frames.length;

    wrapper.unmount();

    expect(cancel).toHaveBeenCalledWith(queuedFrameCount);
    expect(frames).toHaveLength(queuedFrameCount);
  });
});
