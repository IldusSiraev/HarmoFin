import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CalendarHeader from './CalendarHeader.vue';

interface HeaderProps {
  view: 'month' | 'agenda';
  title: string;
  ownerFilter: 'all' | 'mine';
  showOwnerFilter: boolean;
  showPlans: boolean;
  canCreate: boolean;
}

const baseProps: HeaderProps = {
  view: 'agenda',
  title: '30 окт – 12 ноя',
  ownerFilter: 'all',
  showOwnerFilter: true,
  showPlans: true,
  canCreate: true,
};

function mountHeader(props: Partial<HeaderProps> = {}) {
  return mount(CalendarHeader, { props: { ...baseProps, ...props } });
}

describe('CalendarHeader', () => {
  it('shows the passed period title', () => {
    expect(mountHeader().get('[data-testid="calendar-period"]').text()).toBe('30 окт – 12 ноя');
  });

  it('lets the page move focus to the period title', () => {
    expect(mountHeader().get('[data-testid="calendar-period"]').attributes('tabindex')).toBe('-1');
  });

  it('keeps the tab order equal to the visual order of the controls', () => {
    const controls = mountHeader().get('.calendar-header__controls').element;
    const order = [...controls.children].map((child) => {
      const element = child as HTMLElement;
      if (element.querySelector('[data-testid^="calendar-view-"]')) return 'view';
      if (element.querySelector('[data-testid="calendar-period"]')) return 'nav';
      if (element.querySelector('[data-testid^="calendar-owner-"]')) return 'owner';
      if (element.dataset.testid === 'calendar-plans-toggle') return 'plans';
      if (element.querySelector('[data-testid="calendar-create"]')) return 'create';
      return 'other';
    });
    expect(order).toEqual(['view', 'nav', 'owner', 'plans', 'create']);
  });

  it('emits navigation events with labelled arrows', async () => {
    const wrapper = mountHeader();
    await wrapper.get('button[aria-label="Предыдущий период"]').trigger('click');
    await wrapper.get('button[aria-label="Следующий период"]').trigger('click');
    const today = wrapper.get('[data-testid="calendar-today"]');
    expect(today.text()).toBe('Сегодня');
    await today.trigger('click');
    expect(wrapper.emitted('previous')).toHaveLength(1);
    expect(wrapper.emitted('next')).toHaveLength(1);
    expect(wrapper.emitted('today')).toHaveLength(1);
  });

  it('switches view and owner filter', async () => {
    const wrapper = mountHeader();
    await wrapper.get('[data-testid="calendar-view-month"]').trigger('click');
    expect(wrapper.emitted('update:view')?.[0]).toEqual(['month']);
    await wrapper.get('[data-testid="calendar-owner-mine"]').trigger('click');
    expect(wrapper.emitted('update:ownerFilter')?.[0]).toEqual(['mine']);
  });

  it('hides the owner filter for a single-person family', () => {
    const wrapper = mountHeader({ showOwnerFilter: false });
    expect(wrapper.find('[role="group"][aria-label="Чьи события"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="calendar-owner-all"]').exists()).toBe(false);
  });

  it('hides creation without the right to create', () => {
    const wrapper = mountHeader({ canCreate: false });
    expect(wrapper.find('[data-testid="calendar-create"]').exists()).toBe(false);
  });

  it('emits create from a button with an accessible name', async () => {
    const wrapper = mountHeader();
    const create = wrapper.get('[data-testid="calendar-create"]');
    expect(create.attributes('aria-label')).toBe('Новое событие');
    // Icon-only below 1024px: the tooltip names it for sighted pointer users too.
    expect(create.element.closest('.ui-tooltip')).not.toBeNull();
    await create.trigger('focusin');
    expect(wrapper.get('[role="tooltip"]').text()).toBe('Новое событие');
    await create.trigger('click');
    expect(wrapper.emitted('create')).toHaveLength(1);
  });

  it('toggles payments with a switch', async () => {
    const wrapper = mountHeader({ showPlans: true });
    const toggle = wrapper.get('[data-testid="calendar-plans-toggle"]');
    expect(toggle.attributes('role')).toBe('switch');
    expect(toggle.attributes('aria-checked')).toBe('true');
    expect(toggle.text()).toContain('Платежи');
    await toggle.trigger('click');
    expect(wrapper.emitted('update:showPlans')?.[0]).toEqual([false]);
  });
});
