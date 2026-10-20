import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { findSelect, selectOption } from '../../test/select-option.js';
import DirectTransferForm from './DirectTransferForm.vue';

const accounts = [
  { value: 'source-account', label: 'Основной счёт' },
  { value: 'destination-account', label: 'Накопительный счёт' },
];

function mountForm(model: Partial<Record<string, string>> = {}, errors = {}) {
  return mount(DirectTransferForm, {
    attachTo: document.body,
    props: {
      model: {
        total: '700',
        occurredOn: '2026-10-17',
        sourceAccountId: '',
        destinationAccountId: '',
        comment: '',
        ...model,
      },
      accounts,
      errors,
    },
  });
}

function errorOf(wrapper: ReturnType<typeof mountForm>, name: string) {
  return findSelect(wrapper, name)?.querySelector('.ui-select__error')?.textContent?.trim();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DirectTransferForm', () => {
  it('does not submit without accounts and shows field errors', async () => {
    const wrapper = mountForm();
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(errorOf(wrapper, 'sourceAccountId')).toBe('Выберите счёт списания');
    expect(errorOf(wrapper, 'destinationAccountId')).toBe('Выберите счёт зачисления');
    expect(
      findSelect(wrapper, 'sourceAccountId')
        ?.querySelector('[role="combobox"]')
        ?.getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('blocks only the missing destination and clears its error once chosen', async () => {
    const wrapper = mountForm({ sourceAccountId: 'source-account' });
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(errorOf(wrapper, 'sourceAccountId')).toBeUndefined();
    expect(errorOf(wrapper, 'destinationAccountId')).toBe('Выберите счёт зачисления');

    await selectOption(wrapper, 'destinationAccountId', 'destination-account');
    expect(errorOf(wrapper, 'destinationAccountId')).toBeUndefined();

    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          sourceAccountId: 'source-account',
          destinationAccountId: 'destination-account',
          amount: '700',
          occurredOn: '2026-10-17',
        },
      ],
    ]);
  });

  it('still shows server field errors for chosen accounts', () => {
    const wrapper = mountForm(
      { sourceAccountId: 'source-account', destinationAccountId: 'destination-account' },
      { destinationAccountId: 'Счёт недоступен' },
    );
    expect(errorOf(wrapper, 'destinationAccountId')).toBe('Счёт недоступен');
  });

  it('sends the comment and uses a custom submit label', async () => {
    const wrapper = mount(DirectTransferForm, {
      attachTo: document.body,
      props: {
        model: {
          total: '700',
          occurredOn: '2026-10-17',
          sourceAccountId: 'source-account',
          destinationAccountId: 'destination-account',
          comment: '',
        },
        accounts,
        errors: {},
        submitLabel: 'Сохранить изменения',
      },
    });

    expect(wrapper.text()).toContain('Сохранить изменения');
    await wrapper.get('input[name="comment"]').setValue('Отпуск');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({ comment: 'Отпуск' });
  });
});
