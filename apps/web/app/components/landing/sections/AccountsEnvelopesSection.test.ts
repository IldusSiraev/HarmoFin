import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AccountsEnvelopesSection from './AccountsEnvelopesSection.vue';

describe('AccountsEnvelopesSection', () => {
  it('pairs each explanation with its inert real preview and preserves captions', () => {
    const wrapper = mount(AccountsEnvelopesSection, {
      global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    });
    const columns = wrapper.findAll('.accounts-envelopes__column');
    expect(columns).toHaveLength(2);
    expect(columns[0]?.get('.accounts-envelopes__explanation').text()).toContain(
      'Счета — где лежат деньги',
    );
    expect(columns[0]?.get('figcaption').text()).toContain('232 300 ₽');
    expect(columns[1]?.get('.accounts-envelopes__explanation').text()).toContain(
      'Конверты — на что они отложены',
    );
    expect(columns[1]?.get('figcaption').text()).toContain('накопления на ремонт и резерв');
    expect(wrapper.findAll('[inert]')).toHaveLength(2);
    expect(wrapper.get('.landing-section__header-aside img').attributes('alt')).toBe('');
    expect(wrapper.get('.accounts-envelopes__note').text()).toContain('Не распределено');
    expect(wrapper.findAll('.accounts-envelopes__note')).toHaveLength(1);
  });
});
