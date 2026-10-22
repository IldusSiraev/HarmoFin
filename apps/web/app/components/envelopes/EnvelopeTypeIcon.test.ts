import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EnvelopeTypeIcon from './EnvelopeTypeIcon.vue';

describe('EnvelopeTypeIcon', () => {
  it('ставит класс тона и скрывает иконку от скринридера', () => {
    const wrapper = mount(EnvelopeTypeIcon, { props: { envelopeType: 'SAVINGS_GOAL' } });
    expect(wrapper.classes()).toContain('envelope-type-icon--savings');
    expect(wrapper.classes()).toContain('envelope-type-icon--md');
    expect(wrapper.attributes('aria-hidden')).toBe('true');
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('малый размер', () => {
    const wrapper = mount(EnvelopeTypeIcon, { props: { envelopeType: 'RESERVE', size: 'sm' } });
    expect(wrapper.classes()).toContain('envelope-type-icon--sm');
    expect(wrapper.classes()).toContain('envelope-type-icon--reserve');
  });
});
