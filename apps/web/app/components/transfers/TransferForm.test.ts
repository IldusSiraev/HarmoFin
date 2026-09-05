import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TransferForm from './TransferForm.vue';
import { createTransferForm } from '../../composables/useTransferForm.js';

const accounts = [
  { value: 'source-account', label: 'Основной счёт' },
  { value: 'destination-account', label: 'Накопительный счёт' },
];
const envelopes = [
  { value: 'repair', label: 'Ремонт' },
  { value: 'mandatory', label: 'Обязательные' },
];

describe('TransferForm', () => {
  it('adds and removes a transfer part while preserving labels and field errors', async () => {
    const wrapper = mount(TransferForm, {
      props: {
        accounts,
        envelopes,
        model: createTransferForm(),
        errors: { parts: 'Сумма частей не совпадает.' },
      },
    });

    const addButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Добавить часть');
    if (!addButton) throw new Error('Missing add part button');
    await addButton.trigger('click');
    expect(wrapper.findAll('[data-transfer-part]')).toHaveLength(2);
    expect(wrapper.text()).toContain('Сумма частей не совпадает.');
    const removeButton = wrapper
      .findAll('button')
      .find((button) => button.attributes('aria-label') === 'Удалить часть 2');
    if (!removeButton) throw new Error('Missing remove second part button');
    await removeButton.trigger('click');
    expect(wrapper.findAll('[data-transfer-part]')).toHaveLength(1);
  });

  it('resets the default destination envelope after changing source envelope', async () => {
    const wrapper = mount(TransferForm, {
      props: { accounts, envelopes, model: createTransferForm() },
    });

    const source = wrapper.get('select[name="sourceEnvelopeId-0"]');
    await source.setValue('repair');
    await source.setValue('mandatory');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      parts: [{ sourceEnvelopeId: 'mandatory', amount: '' }],
    });
  });
});
