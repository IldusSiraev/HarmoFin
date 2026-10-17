import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ReportCard from './ReportCard.vue';

describe('ReportCard', () => {
  it('ошибка с повтором', async () => {
    const wrapper = mount(ReportCard, {
      props: {
        title: 'Структура',
        loading: false,
        error: 'Не удалось загрузить отчёт.',
        empty: false,
      },
    });
    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось загрузить отчёт.');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('пусто — подсказка, иначе слот', () => {
    const empty = mount(ReportCard, {
      props: { title: 'Структура', loading: false, error: '', empty: true },
      slots: { default: '<p data-content>график</p>' },
    });
    expect(empty.text()).toContain('Нет данных');
    expect(empty.find('[data-content]').exists()).toBe(false);
    const filled = mount(ReportCard, {
      props: { title: 'Структура', loading: false, error: '', empty: false },
      slots: { default: '<p data-content>график</p>' },
    });
    expect(filled.find('[data-content]').exists()).toBe(true);
    expect(filled.get('h2').text()).toBe('Структура');
  });
});
