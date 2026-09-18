import { Banknote, CreditCard, Landmark } from '@lucide/vue';

import type { AccountDto, AccountType } from '../../composables/useBudgetReferenceData.js';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  BANK_ACCOUNT: 'Банковский счёт',
  BANK_CARD: 'Банковская карта',
  CASH: 'Наличные',
};

export const ACCOUNT_TYPE_ICONS: Record<AccountType, typeof Landmark> = {
  BANK_ACCOUNT: Landmark,
  BANK_CARD: CreditCard,
  CASH: Banknote,
};

export function accountSubtitle(
  account: Pick<AccountDto, 'accountType' | 'bankName' | 'lastFourDigits'>,
): string {
  return [ACCOUNT_TYPE_LABELS[account.accountType], account.bankName, account.lastFourDigits]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}
