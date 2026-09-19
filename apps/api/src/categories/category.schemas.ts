import { z } from 'zod';

const categoryFields = {
  name: z.string().trim().min(1).max(120),
  categoryType: z.enum(['INCOME', 'EXPENSE']),
  parentId: z.string().uuid().nullable().optional(),
  displayOrder: z.number().int().min(0).max(1_000_000),
  comment: z.string().trim().min(1).max(500).nullable().optional(),
};

export const createCategorySchema = z.object(categoryFields).strict();

export const updateCategorySchema = z
  .object({
    name: categoryFields.name.optional(),
    parentId: categoryFields.parentId,
    displayOrder: categoryFields.displayOrder.optional(),
    comment: categoryFields.comment,
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
