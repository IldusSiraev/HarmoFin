import { computed } from 'vue';
import { useRuntimeConfig } from '#imports';

import { useApiClient } from './useApiClient.js';

export type LegalOperator = {
  name: string;
  inn: string;
  email: string;
  hostingProvider: string;
  emailProvider: string;
};

export type LegalDocument = {
  document: 'TERMS' | 'PRIVACY_POLICY' | 'PD_CONSENT';
  version: string;
  effectiveOn: string;
};

// Nuxt parses NUXT_PUBLIC_* env values, so an all-digit value arrives as a number.
function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

// A personal INN has 12 digits; numeric parsing drops the leading 0 of regions 01-09.
function inn(value: unknown): string {
  const digits = text(value);
  return typeof value === 'number' && digits.length === 11 ? `0${digits}` : digits;
}

export function useLegal() {
  const config = useRuntimeConfig().public.legal as Record<
    'operatorName' | 'operatorInn' | 'operatorEmail' | 'hostingProvider' | 'emailProvider',
    unknown
  >;
  const api = useApiClient();

  const operator = computed<LegalOperator>(() => ({
    name: text(config.operatorName),
    inn: inn(config.operatorInn),
    email: text(config.operatorEmail),
    hostingProvider: text(config.hostingProvider),
    emailProvider: text(config.emailProvider),
  }));

  const operatorComplete = computed(
    () =>
      operator.value.name.length > 0 &&
      /^\d{12}$/.test(operator.value.inn) &&
      operator.value.email.includes('@') &&
      operator.value.hostingProvider.length > 0 &&
      operator.value.emailProvider.length > 0,
  );

  function loadDocuments(): Promise<LegalDocument[]> {
    return api.request<LegalDocument[]>('/api/v1/legal/documents');
  }

  return { operator, operatorComplete, loadDocuments };
}
