import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

const state = vi.hoisted(() => ({ email: 'privacy@harmofin.example' }));

vi.mock('../../composables/useLegal.js', () => ({
  useLegal: () => ({ operator: computed(() => ({ email: state.email })) }),
}));

import LandingFooter from './LandingFooter.vue';

const stubs = { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('LandingFooter', () => {
  it('links the three legal documents and the operator contact', () => {
    state.email = 'privacy@harmofin.example';
    const wrapper = mount(LandingFooter, { global: { stubs } });
    const links = wrapper.findAll('a').map((link) => [link.text(), link.attributes('href')]);

    expect(links).toEqual(
      expect.arrayContaining([
        ['Политика обработки персональных данных', '/privacy'],
        ['Пользовательское соглашение', '/terms'],
        ['Согласие на обработку персональных данных', '/consent'],
        ['Контакты', 'mailto:privacy@harmofin.example'],
      ]),
    );
  });

  it('hides the contact link while the operator email is not set', () => {
    state.email = '';
    const wrapper = mount(LandingFooter, { global: { stubs } });
    expect(wrapper.text()).not.toContain('Контакты');
  });
});
