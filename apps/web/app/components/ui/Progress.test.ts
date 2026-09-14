import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiProgress from './Progress.vue';

const mountProgress = (value: string, max: string) =>
  mount(UiProgress, { props: { value, max, label: 'Накоплено 1 000,00 ₽ из 5 000,00 ₽' } });

describe('UiProgress', () => {
  it('announces itself as a labelled progress bar', () => {
    const bar = mountProgress('100000', '500000').get('[role="progressbar"]');

    expect(bar.attributes('aria-valuenow')).toBe('20');
    expect(bar.attributes('aria-valuemin')).toBe('0');
    expect(bar.attributes('aria-valuemax')).toBe('100');
    expect(bar.attributes('aria-label')).toBe('Накоплено 1 000,00 ₽ из 5 000,00 ₽');
    expect(bar.attributes('aria-valuetext')).toBe('Накоплено 1 000,00 ₽ из 5 000,00 ₽');
  });

  it('never runs past the end or below zero', () => {
    expect(
      mountProgress('900000', '500000').get('[role="progressbar"]').attributes('aria-valuenow'),
    ).toBe('100');
    expect(
      mountProgress('-5000', '500000').get('[role="progressbar"]').attributes('aria-valuenow'),
    ).toBe('0');
  });

  it('shows an empty bar when there is nothing to divide by', () => {
    expect(
      mountProgress('100000', '0').get('[role="progressbar"]').attributes('aria-valuenow'),
    ).toBe('0');
  });
});
