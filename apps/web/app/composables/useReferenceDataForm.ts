import { ApiRequestError } from './useApiClient.js';

export const GENERIC_ACTION_ERROR = 'Не удалось выполнить действие. Повторите попытку.';

export type ReferenceDataFormError<Field extends string> = {
  summary: string;
  fields: Partial<Record<Field, string>>;
};

export function createReferenceDataForm<const Field extends string>(fields: readonly Field[]) {
  const knownFields = new Set<string>(fields);

  function normalizeDecimal(value: string): string {
    return value.replace(/\s/gu, '').replace(',', '.');
  }

  function errorMessage(error: unknown): ReferenceDataFormError<Field> {
    if (!(error instanceof ApiRequestError)) {
      return { summary: GENERIC_ACTION_ERROR, fields: {} };
    }

    const mappedFields = Object.fromEntries(
      (error.problem.fieldErrors ?? [])
        .filter((field) => knownFields.has(field.field))
        .map((field) => [field.field, field.message]),
    ) as Partial<Record<Field, string>>;

    if (Object.keys(mappedFields).length > 0) {
      return { summary: 'Укажите данные формы.', fields: mappedFields };
    }

    return { summary: GENERIC_ACTION_ERROR, fields: {} };
  }

  return { normalizeDecimal, errorMessage };
}

export function useReferenceDataForm<const Field extends string>(fields: readonly Field[]) {
  return createReferenceDataForm(fields);
}
