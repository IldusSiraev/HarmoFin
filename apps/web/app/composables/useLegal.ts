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

export function useLegal() {
  const config = useRuntimeConfig().public.legal as {
    operatorName: string;
    operatorInn: string;
    operatorEmail: string;
    hostingProvider: string;
    emailProvider: string;
  };
  const api = useApiClient();

  const operator = computed<LegalOperator>(() => ({
    name: config.operatorName.trim(),
    inn: config.operatorInn.trim(),
    email: config.operatorEmail.trim(),
    hostingProvider: config.hostingProvider.trim(),
    emailProvider: config.emailProvider.trim(),
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
