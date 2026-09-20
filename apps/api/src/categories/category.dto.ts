import { ApiProperty } from '@nestjs/swagger';

import { CATEGORY_ICON_KEYS } from './category.schemas.js';

export class CreateCategoryRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120 })
  name!: string;

  @ApiProperty({ enum: ['INCOME', 'EXPENSE'] })
  categoryType!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, required: false })
  parentId?: string | null;

  @ApiProperty({ type: Number, minimum: 0, maximum: 1_000_000 })
  displayOrder!: number;

  @ApiProperty({ type: String, nullable: true, required: false, maxLength: 500 })
  comment?: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    enum: CATEGORY_ICON_KEYS,
    description: 'One of the fixed category-icon keys.',
  })
  icon?: string | null;
}

export class UpdateCategoryRequest {
  @ApiProperty({ type: String, required: false, minLength: 1, maxLength: 120 })
  name?: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, required: false })
  parentId?: string | null;

  @ApiProperty({ type: Number, required: false, minimum: 0, maximum: 1_000_000 })
  displayOrder?: number;

  @ApiProperty({ type: String, nullable: true, required: false, maxLength: 500 })
  comment?: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    enum: CATEGORY_ICON_KEYS,
    description: 'One of the fixed category-icon keys.',
  })
  icon?: string | null;
}

export class CategoryResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ type: String, nullable: true })
  templateKey!: string | null;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ enum: ['INCOME', 'EXPENSE'] })
  categoryType!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  parentId!: string | null;

  @ApiProperty({ type: Number, minimum: 0 })
  displayOrder!: number;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: CATEGORY_ICON_KEYS,
    description: 'One of the fixed category-icon keys.',
  })
  icon!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  archivedAt!: string | null;
}
