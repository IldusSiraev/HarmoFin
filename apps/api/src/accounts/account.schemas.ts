import { z } from 'zod';

const accountFields = {
  name: z.string().trim().min(1).max(120),
  accountType: z.enum(['BANK_ACCOUNT', 'BANK_CARD', 'CASH']),
  bankName: z.string().trim().min(1).max(120).nullable().optional(),
  lastFourDigits: z
    .string()
    .regex(/^\d{4}$/)
    .nullable()
    .optional(),
  currency: z.literal('RUB'),
  startingBalance: z.string().min(1).max(64),
  accountingStartDate: z.string().date(),
  comment: z.string().trim().min(1).max(500).nullable().optional(),
};

export const createAccountSchema = z.object(accountFields).strict();

export const updateAccountSchema = z
  .object({
    name: accountFields.name.optional(),
    accountType: accountFields.accountType.optional(),
    bankName: accountFields.bankName,
    lastFourDigits: accountFields.lastFourDigits,
    startingBalance: accountFields.startingBalance.optional(),
    accountingStartDate: accountFields.accountingStartDate.optional(),
    comment: accountFields.comment,
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Необходимо передать хотя бы одно поле для изменения.',
  });

export const listAccountsSchema = z
  .object({
    status: z.enum(['active', 'archived', 'all']).default('active'),
    ownerUserId: z.string().uuid().optional(),
  })
  .strict();

export const accountSummarySchema = z
  .object({
    status: z.enum(['active', 'archived', 'all']).default('active'),
    ownerUserId: z.string().uuid().optional(),
  })
  .strict();

export type CreateAccountInput = z.output<typeof createAccountSchema>;
export type UpdateAccountInput = z.output<typeof updateAccountSchema>;
export type ListAccountsInput = z.output<typeof listAccountsSchema>;
export type AccountSummaryInput = z.output<typeof accountSummarySchema>;
