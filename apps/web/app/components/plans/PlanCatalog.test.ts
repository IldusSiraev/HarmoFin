import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlanCatalog from './PlanCatalog.vue';
import type { PlanCatalogEntry } from './plan-edit.js';

const norm = (value: string) => value.replace(/\s/g, ' ');

const rent: PlanCatalogEntry = {
  kind: 'obligation',
  id: 'plan-1',
  name: 'Аренда',
  amountMinor: '4000000',
  recurrence: 'MONTHLY',
  intervalMonths: null,
  scheduledOn: '2026-10-05',
  active: true,
};
const gym: PlanCatalogEntry = {
  kind: 'obligation',
  id: 'plan-2',
  name: 'Спортзал',
  amountMinor: '300000',
  recurrence: 'YEARLY',
  intervalMonths: null,
  scheduledOn: '2026-11-01',
  active: false,
};
const salary: PlanCatalogEntry = {
  kind: 'income',
  id: 'plan-3',
  name: 'Премия',
  amountMinor: '1500000',
  recurrence: 'EVERY_N_MONTHS',
  intervalMonths: 3,
  scheduledOn: '2026-12-10',
  active: true,
};
const entries = [rent, gym, salary];

describe('PlanCatalog', () => {
  it('is collapsed by default and counts the entries', () => {
    const wrapper = mount(PlanCatalog, { props: { entries } });
    const details = wrapper.get('[data-testid="plan-catalog"]');
    expect(details.element.tagName).toBe('DETAILS');
    expect(details.attributes('open')).toBeUndefined();
    expect(wrapper.get('summary').text()).toContain('Все планы (3)');
  });

  it('shows an active obligation with edit action only', () => {
    const wrapper = mount(PlanCatalog, { props: { entries } });
    const row = wrapper.get('[data-testid="catalog-row-obligation-plan-1"]');
    const text = norm(row.text());
    expect(text).toContain('Аренда');
    expect(text).toContain('Платёж');
    expect(text).toContain('Каждый месяц');
    expect(text).toContain('Активен');
    expect(text).toContain('40 000,00');
    expect(wrapper.find('[data-testid="catalog-edit-plan-1"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="catalog-edit-plan-1"]').attributes('aria-label')).toBe(
      'Изменить план Аренда',
    );
    expect(wrapper.find('[data-testid="catalog-resume-plan-1"]').exists()).toBe(false);
  });

  it('shows a stopped plan with resume action only', () => {
    const wrapper = mount(PlanCatalog, { props: { entries } });
    const row = wrapper.get('[data-testid="catalog-row-obligation-plan-2"]');
    expect(row.text()).toContain('Остановлен');
    expect(row.text()).toContain('Раз в год');
    expect(wrapper.get('[data-testid="catalog-resume-plan-2"]').attributes('aria-label')).toBe(
      'Возобновить план Спортзал',
    );
    expect(wrapper.find('[data-testid="catalog-edit-plan-2"]').exists()).toBe(false);
  });

  it('labels income plans and every-N-months recurrence', () => {
    const wrapper = mount(PlanCatalog, { props: { entries } });
    const text = norm(wrapper.get('[data-testid="catalog-row-income-plan-3"]').text());
    expect(text).toContain('Доход');
    expect(text).not.toContain('Платёж');
    expect(text).toContain('Раз в 3 мес.');
    expect(text).toContain('15 000,00');
  });

  it('emits edit and resume with the original entry', async () => {
    const wrapper = mount(PlanCatalog, { props: { entries } });
    await wrapper.get('[data-testid="catalog-edit-plan-1"]').trigger('click');
    await wrapper.get('[data-testid="catalog-resume-plan-2"]').trigger('click');
    expect(wrapper.emitted('edit')).toEqual([[rent]]);
    expect(wrapper.emitted('resume')).toEqual([[gym]]);
  });

  it('disables actions while busy', () => {
    const wrapper = mount(PlanCatalog, { props: { entries, busy: true } });
    expect(wrapper.get('[data-testid="catalog-edit-plan-1"]').attributes('disabled')).toBeDefined();
    expect(
      wrapper.get('[data-testid="catalog-resume-plan-2"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('shows the empty state', () => {
    const wrapper = mount(PlanCatalog, { props: { entries: [] } });
    expect(wrapper.get('summary').text()).toContain('Все планы (0)');
    expect(wrapper.get('[data-testid="catalog-empty"]').text()).toBe('Планов пока нет.');
  });

  it('shows an alert when loading failed', () => {
    const wrapper = mount(PlanCatalog, { props: { entries: [], loadFailed: true } });
    const error = wrapper.get('[data-testid="catalog-error"]');
    expect(error.attributes('role')).toBe('alert');
    expect(error.text()).toBe('Не удалось загрузить список планов.');
    expect(wrapper.get('summary').text()).toBe('Все планы (ошибка загрузки)');
  });

  it('keeps the normal summary when loading succeeded', () => {
    const wrapper = mount(PlanCatalog, { props: { entries } });
    expect(wrapper.get('summary').text()).toBe('Все планы (3)');
    expect(wrapper.get('summary').text()).not.toContain('ошибка');
  });

  it('hides edit and resume when canManage is false', () => {
    const wrapper = mount(PlanCatalog, { props: { entries, canManage: false } });

    expect(wrapper.find('[data-testid="catalog-edit-plan-1"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="catalog-resume-plan-2"]').exists()).toBe(false);
  });

  it('drops the actions column when canManage is false, instead of an empty gap', () => {
    const wrapper = mount(PlanCatalog, { props: { entries, canManage: false } });

    expect(wrapper.get('[data-testid="catalog-row-obligation-plan-1"]').classes()).toContain(
      'obligation-row--no-actions',
    );
  });

  it('keeps the actions column when canManage is true', () => {
    const wrapper = mount(PlanCatalog, { props: { entries } });

    expect(wrapper.get('[data-testid="catalog-row-obligation-plan-1"]').classes()).not.toContain(
      'obligation-row--no-actions',
    );
  });
});
