import { z } from 'zod';

// Mirrors the keys in CATEGORY_ICON_OPTIONS in apps/web/app/components/operations/category-icon.ts — keep both in sync.
export const CATEGORY_ICON_KEYS = [
  'award',
  'baby',
  'banknote',
  'car',
  'circle-dollar-sign',
  'coffee',
  'credit-card',
  'dumbbell',
  'ellipsis',
  'fuel',
  'gift',
  'hammer',
  'hand-coins',
  'heart-pulse',
  'house',
  'key-round',
  'landmark',
  'package',
  'palette',
  'paw-print',
  'percent',
  'pill',
  'plane',
  'repeat',
  'school',
  'shield-check',
  'shirt',
  'shopping-cart',
  'smartphone',
  'sparkles',
  'spray-can',
  'square-parking',
  'stethoscope',
  'syringe',
  'tag',
  'ticket',
  'truck',
  'utensils',
  'volleyball',
  'wallet',
  'wifi',
  'wine',
  'wrench',
  'zap',
] as const;

const categoryFields = {
  name: z.string().trim().min(1).max(120),
  categoryType: z.enum(['INCOME', 'EXPENSE']),
  parentId: z.string().uuid().nullable().optional(),
  displayOrder: z.number().int().min(0).max(1_000_000),
  comment: z.string().trim().min(1).max(500).nullable().optional(),
  icon: z.enum(CATEGORY_ICON_KEYS).nullable().optional(),
};

export const createCategorySchema = z.object(categoryFields).strict();

export const updateCategorySchema = z
  .object({
    name: categoryFields.name.optional(),
    parentId: categoryFields.parentId,
    displayOrder: categoryFields.displayOrder.optional(),
    comment: categoryFields.comment,
    icon: categoryFields.icon,
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Необходимо передать хотя бы одно поле для изменения.',
  });

export const listCategoriesSchema = z
  .object({
    type: z.enum(['INCOME', 'EXPENSE']).optional(),
    status: z.enum(['active', 'archived', 'all']).default('active'),
    sort: z.enum(['default', 'popular']).default('default'),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

export type CreateCategoryInput = z.output<typeof createCategorySchema>;
export type UpdateCategoryInput = z.output<typeof updateCategorySchema>;
export type ListCategoriesInput = z.output<typeof listCategoriesSchema>;
