import { ApiProperty } from '@nestjs/swagger';

const STATUSES = ['EXISTING', 'MISSING', 'ARCHIVED', 'COLLISION'];
const ACTIONS = ['CREATE', 'ADOPT', 'SKIP'];

export class TemplateCycleDto {
  @ApiProperty({ type: Number, example: 1 })
  cycleStartDay!: number;

  @ApiProperty({ type: Number, example: 14 })
  periodBoundaryOffset!: number;
}

class TemplateMatchFields {
  @ApiProperty({ type: String, enum: STATUSES })
  status!: string;

  @ApiProperty({ type: String, enum: ['KEY', 'NAME'], nullable: true })
  matchedBy!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  existingId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Имя найденного элемента как есть.' })
  existingName!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  archivedId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Элемент с тем же именем и несовместимым типом/ролью периода.',
  })
  collisionId!: string | null;

  @ApiProperty({ type: String, enum: ACTIONS })
  suggestedAction!: string;

  @ApiProperty({
    type: Boolean,
    description: 'true для замены архивного элемента: нужно явное согласие владельца.',
  })
  requiresConsent!: boolean;
}

export class TemplateCategoryPreviewDto extends TemplateMatchFields {
  @ApiProperty({ type: String, example: 'expense-groceries' })
  templateKey!: string;

  @ApiProperty({ type: String, example: 'Продукты' })
  name!: string;

  @ApiProperty({ type: String, enum: ['INCOME', 'EXPENSE'] })
  categoryType!: string;

  @ApiProperty({ type: String, nullable: true })
  parentTemplateKey!: string | null;
}

export class TemplateEnvelopePreviewDto extends TemplateMatchFields {
  @ApiProperty({ type: String, enum: ['FIRST', 'SECOND', 'MANDATORY', 'SAVINGS'] })
  role!: string;

  @ApiProperty({ type: String, example: 'v2-period-first' })
  templateKey!: string;

  @ApiProperty({ type: String, example: 'Первый период' })
  name!: string;

  @ApiProperty({
    type: String,
    example: 'CURRENT_EXPENSES',
    description: 'FREE_MONEY не предлагается.',
  })
  type!: string;

  @ApiProperty({ type: String, enum: ['FIRST', 'SECOND'], nullable: true })
  periodSlot!: string | null;

  @ApiProperty({ type: Boolean, description: 'true: накопление по выбору, а не по умолчанию.' })
  selectable!: boolean;

  @ApiProperty({ type: String, example: 'FIXED_PER_PERIOD' })
  suggestedRuleType!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Тип уже заданного правила конверта.' })
  existingRuleType!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Необязательная цель периода (minor units); шаблон её не предлагает.',
  })
  suggestedTargetMinor!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'v2-replacement-mandatory-018f0000-0000-7000-8000-000000000000',
    description: 'Ключ замены архивного элемента; используется только при явном CREATE.',
  })
  replacementTemplateKey!: string | null;
}

export class TemplatePreviewResponse {
  @ApiProperty({ type: () => TemplateCycleDto })
  cycle!: TemplateCycleDto;

  @ApiProperty({ type: () => [TemplateCategoryPreviewDto] })
  categories!: TemplateCategoryPreviewDto[];

  @ApiProperty({ type: () => [TemplateEnvelopePreviewDto] })
  envelopes!: TemplateEnvelopePreviewDto[];

  @ApiProperty({
    type: Boolean,
    description:
      'Все категории и базовые конверты уже есть; «любая категория» шаблон не завершает.',
  })
  isComplete!: boolean;

  @ApiProperty({
    type: String,
    example: 'a'.repeat(64),
    description: 'sha256 текущих элементов и настроек; нужен для последующего apply.',
  })
  previewHash!: string;
}
