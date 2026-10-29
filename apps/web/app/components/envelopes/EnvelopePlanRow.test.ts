import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EnvelopePlanRow from './EnvelopePlanRow.vue';

const base = {
  id: 'e1',
  name: 'Ремонт',
  envelopeType: 'CUSTOM',
  periodSlot: null,
  targetAmountMinor: null,
  comment: null,
  fundedMinor: '4000000',
  spentMinor: '1200000',
  balanceMinor: '2800000',
  archivedAt: null,
  owner: { userId: 'user-owner', displayName: null, isActiveMember: true },
  canEdit: true,
};

const plain = (value: string): string => value.replace(/\s/g, ' ');

const mountRow = (props: Record<string, unknown>) =>
  mount(EnvelopePlanRow, { props: { progress: null, badge: null, ...props } as never });

describe('EnvelopePlanRow', () => {
  it('shows funded, spent and left as assignment values with a full accessible label', () => {
    const wrapper = mountRow({ envelope: base });

    const text = plain(wrapper.text());
    expect(text).toContain('Отложено 40 000');
    expect(text).toContain('потрачено 12 000');
    expect(text).toContain('Осталось');
    expect(text).toContain('28 000');
    expect(text).not.toContain('Начальный баланс конверта');
    expect(
      plain(wrapper.get('[data-testid="list-row-select"]').attributes('aria-label')!),
    ).toContain('осталось 28 000');
  });

  it('emits select when the card is clicked', async () => {
    const wrapper = mountRow({ envelope: base });

    await wrapper.get('[data-testid="list-row-select"]').trigger('click');

    expect(wrapper.emitted('select')).toHaveLength(1);
  });

  it('shows the type icon tile in the type tone', () => {
    const wrapper = mountRow({ envelope: { ...base, envelopeType: 'SAVINGS_GOAL' } });

    expect(wrapper.find('.envelope-type-icon--savings').exists()).toBe(true);
  });

  it('captions a period envelope with its half of the period', () => {
    const wrapper = mountRow({
      envelope: { ...base, envelopeType: 'CURRENT_EXPENSES', periodSlot: 'SECOND' },
    });

    expect(wrapper.get('[data-testid="plan-row-scope"]').text()).toBe(
      'Лимит на вторую половину периода',
    );
  });

  it('captions an envelope without a goal with its scope note', () => {
    const wrapper = mountRow({ envelope: { ...base, envelopeType: 'RESERVE' } });

    expect(wrapper.get('[data-testid="plan-row-scope"]').text()).toContain('не сбрасывается');
  });

  it.each([
    ['5000', '5 000,00'],
    ['5000.5', '5 000,50'],
    ['5000.00', '5 000,00'],
    ['0', '0,00'],
  ])('shows the decimal-ruble goal %s as %s', (target, shown) => {
    const wrapper = mountRow({
      envelope: { ...base, envelopeType: 'SAVINGS_GOAL', targetAmountMinor: target },
    });

    const caption = plain(wrapper.get('[data-testid="plan-row-scope"]').text());
    expect(caption).toMatch(/^Цель /);
    expect(plain(wrapper.get('[data-testid="plan-row-target"]').text())).toContain(shown);
  });

  it('draws the progress with its label and the same percent as the bar', () => {
    const wrapper = mountRow({
      envelope: base,
      progress: {
        value: '3165000',
        max: '6500000',
        label: 'Потрачено из отложенного',
        tone: 'current',
      },
    });

    const text = plain(wrapper.text());
    expect(text).toContain('Потрачено из отложенного');
    expect(text).toContain('48 %');
    const bar = wrapper.get('[role="progressbar"]');
    expect(bar.attributes('aria-valuenow')).toBe('48');
    expect(plain(bar.attributes('aria-label')!)).toBe('Потрачено из отложенного: 48 %');
    expect(wrapper.find('.ui-progress__fill--current').exists()).toBe(true);
  });

  it('draws no progress bar without progress', () => {
    const wrapper = mountRow({ envelope: base });

    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
  });

  it.each([
    ['danger', 'Перерасход 1 000,00 ₽'],
    ['warning', 'Нужно пополнить на 10 364,69 ₽'],
  ])('shows a %s badge with text and an icon', (tone, text) => {
    const wrapper = mountRow({ envelope: base, badge: { tone, text } });

    const badge = wrapper.get('[data-testid="plan-row-badge"]');
    expect(badge.classes()).toContain(`plan-row__badge--${tone}`);
    expect(plain(badge.text())).toBe(text);
    expect(badge.find('svg').exists()).toBe(true);
  });

  it('shows no badge without one', () => {
    const wrapper = mountRow({ envelope: base });

    expect(wrapper.find('[data-testid="plan-row-badge"]').exists()).toBe(false);
  });

  it('marks a highlighted row with a text label', () => {
    const wrapper = mountRow({ envelope: base, highlight: 'Нужно пополнить' });

    expect(wrapper.get('[data-testid="plan-row-highlight"]').text()).toContain('Нужно пополнить');
  });

  it('renders the actions slot', () => {
    const wrapper = mount(EnvelopePlanRow, {
      props: { envelope: base, progress: null, badge: null },
      slots: { actions: '<button data-testid="row-menu">Меню</button>' },
    });

    expect(wrapper.find('[data-testid="row-menu"]').exists()).toBe(true);
  });
  it('falls back to the overspent badge when no badge prop is given', () => {
    const wrapper = mount(EnvelopePlanRow, {
      props: { envelope: { ...base, balanceMinor: '-100000' } },
    });

    const badge = wrapper.get('[data-testid="plan-row-badge"]');
    expect(badge.classes()).toContain('plan-row__badge--danger');
    expect(plain(badge.text())).toContain('Перерасход 1 000,00');
  });

  it('does not repeat the overspent or highlight phrase next to a badge in the label', () => {
    const wrapper = mountRow({
      envelope: { ...base, balanceMinor: '-100000' },
      badge: { tone: 'danger', text: 'Перерасход 1 000,00 ₽' },
      highlight: 'Нужно пополнить',
    });

    const label = plain(wrapper.get('[data-testid="list-row-select"]').attributes('aria-label')!);
    expect(label).toContain('Перерасход 1 000,00 ₽');
    expect(label).not.toContain(', перерасход');
    expect(label).not.toContain('Нужно пополнить');
  });

  it('keeps the overspent phrase in the label when the badge is not about it', () => {
    const wrapper = mountRow({ envelope: { ...base, balanceMinor: '-100000' } });

    expect(wrapper.get('[data-testid="list-row-select"]').attributes('aria-label')).toContain(
      'перерасход',
    );
  });

  it('reserves the side column only when there is progress, a badge or a highlight', () => {
    expect(mountRow({ envelope: base }).find('.plan-row__grid--side').exists()).toBe(false);
    expect(
      mountRow({ envelope: base, highlight: 'Нужно пополнить' })
        .find('.plan-row__grid--side')
        .exists(),
    ).toBe(true);
    expect(
      mountRow({
        envelope: base,
        progress: { value: '1', max: '2', label: 'Цель', tone: 'custom' },
      })
        .find('.plan-row__grid--side')
        .exists(),
    ).toBe(true);
  });
});
