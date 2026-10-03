import { Landmark, PiggyBank, ShieldCheck, ShoppingCart, Sparkles } from '@lucide/vue';

// Icons by Envelope Plan v2.2 envelope type; unknown types fall back to the
// caller's default.
export const ENVELOPE_TYPE_ICONS: Record<string, typeof Landmark> = {
  CURRENT_EXPENSES: ShoppingCart,
  MANDATORY_EXPENSES: Landmark,
  SAVINGS_GOAL: PiggyBank,
  RESERVE: ShieldCheck,
  CUSTOM: Sparkles,
};
