import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import UiSkeleton from './Skeleton.vue';

describe('UiSkeleton', () => {
  it('is hidden from assistive technology', () => {
    const wrapper = mount(UiSkeleton);

    expect(wrapper.attributes('aria-hidden')).toBe('true');
  });

  it('renders one placeholder by default and the requested number otherwise', () => {
    expect(mount(UiSkeleton).findAll('[data-testid="skeleton-item"]')).toHaveLength(1);
    expect(
      mount(UiSkeleton, { props: { count: 3 } }).findAll('[data-testid="skeleton-item"]'),
    ).toHaveLength(3);
  });

  it('applies the requested variant', () => {
    const wrapper = mount(UiSkeleton, { props: { variant: 'card' } });

    expect(wrapper.get('[data-testid="skeleton-item"]').classes()).toContain(
      'ui-skeleton__item--card',
    );
  });
});
