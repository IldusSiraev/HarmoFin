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

function mockFrames(): Frame[] {
  const frames: Frame[] = [];
  window.requestAnimationFrame = ((callback: Frame) => {
    frames.push(callback);
    return frames.length;
  }) as unknown as typeof window.requestAnimationFrame;
  return frames;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCountUp', () => {
  it('animates from zero to the target value', () => {
    mockReducedMotion(false);
    const frames = mockFrames();
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

  it('jumps straight to the target when reduced motion is requested', () => {
    mockReducedMotion(true);
    const frames = mockFrames();
    const { value, start } = useCountUp(1000);

    start();

    expect(value.value).toBe(1000);
    expect(frames).toHaveLength(0);
  });

  it('ignores repeated start calls once finished', () => {
    mockReducedMotion(true);
    const { value, start } = useCountUp(500);

    start();
    start();

    expect(value.value).toBe(500);
  });
});
