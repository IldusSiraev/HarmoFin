import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('#imports', () => ({ navigateTo: mocks.navigateTo }));

import type { ActivityItem } from '../../composables/useActivityFeed.js';
import ActivityRow from './ActivityRow.vue';

const now = new Date(2026, 9, 30, 18, 0);
const item = (overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  id: 'audit-1',
  occurredAt: new Date(2026, 9, 30, 14, 20).toISOString(),
  kind: 'TRANSACTION_CREATED',
  isNew: true,
  actor: { userId: 'alia', displayName: 'Алия', isActiveMember: true },
  amountMinor: '120000',
  currency: 'RUB',
  transactionType: 'EXPENSE',
  title: 'Продукты',
  details: ['Карта'],
  target: null,
  link: { type: 'TRANSACTION', id: 'tx-1', date: null },
  ...overrides,
});

const normalize = (text: string) => text.replace(/\s/g, ' ');

describe('ActivityRow', () => {
  it('shows author, action, details, amount and the «новое» status as text', () => {
    const wrapper = mount(ActivityRow, { props: { item: item(), now } });
    const text = normalize(wrapper.text());
    expect(text).toContain('Алия · добавлен расход');
    expect(text).toContain('Продукты · Карта · 14:20');
    expect(text).toContain('1 200,00 ₽');
    expect(text).toContain('новое');
    expect(wrapper.find('button').attributes('aria-label')).toContain('новое');
  });

  it('opens the object', async () => {
    const wrapper = mount(ActivityRow, { props: { item: item(), now } });
    await wrapper.find('button').trigger('click');
    expect(mocks.navigateTo).toHaveBeenCalledWith('/app/operations?operationId=tx-1');
  });

  it('marks a deleted operation in text and leaves no button when the object is gone', () => {
    const wrapper = mount(ActivityRow, {
      props: { item: item({ kind: 'TRANSACTION_DELETED', isNew: false, link: null }), now },
    });
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.text()).toContain('удалено');
    expect(wrapper.find('.activity-row__amount--struck').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('новое');
  });
});
