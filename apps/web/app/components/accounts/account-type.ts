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

export type AccountTone = 'bank' | 'card' | 'cash';

const ACCOUNT_TONES: Record<AccountType, AccountTone> = {
  BANK_ACCOUNT: 'bank',
  BANK_CARD: 'card',
  CASH: 'cash',
};

// Tone drives only the type icon tile (Calm Fintech §«Цвет типов»).
export function accountTone(accountType: AccountType): AccountTone {
  return ACCOUNT_TONES[accountType];
}

// Icon colour for places that draw a bare icon (pill select); the tile uses -soft too.
export function accountToneColor(accountType: AccountType): string {
  return `var(--hf-color-account-${ACCOUNT_TONES[accountType]})`;
}

export function accountSubtitle(
  account: Pick<AccountDto, 'accountType' | 'bankName' | 'lastFourDigits'>,
): string {
  return [ACCOUNT_TYPE_LABELS[account.accountType], account.bankName, account.lastFourDigits]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}
