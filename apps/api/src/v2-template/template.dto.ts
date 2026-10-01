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

export class TemplateApplyPeriodDto {
  @ApiProperty({ type: String, enum: ['FIRST', 'SECOND'] })
  role!: string;

  @ApiProperty({
    type: String,
    enum: ACTIONS,
    description:
      'ADOPT только для совместимого действующего элемента; архивный ключ заменяется только явным CREATE; при коллизии имени CREATE требует другое name, иначе SKIP.',
  })
  action!: string;

  @ApiProperty({ type: String, required: false, example: 'Утренний' })
  name?: string;

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    example: '12000.50',
    description:
      'Необязательная цель периода (рубли, десятичная строка). Для нового или принятого конверта без правила создаёт правило FIXED_PER_PERIOD; без цели — MANUAL. Существующие цель и правило не меняются.',
  })
  target?: string | null;

  @ApiProperty({
    type: String,
    enum: ['SUGGESTED', 'MANUAL'],
    required: false,
    description: 'MANUAL: владелец отказался от предложенного правила.',
  })
  ruleChoice?: string;
}

export class TemplateApplyMandatoryDto {
  @ApiProperty({ type: String, enum: ACTIONS })
  action!: string;

  @ApiProperty({ type: String, required: false })
  name?: string;

  @ApiProperty({ type: String, enum: ['SUGGESTED', 'MANUAL'], required: false })
  ruleChoice?: string;
}

export class TemplateApplySavingsDto {
  @ApiProperty({ type: String, example: 'Автомобиль', description: 'Имя накопления из шаблона.' })
  name!: string;

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    example: '5000',
    description: 'Желательный взнос: правило SUGGESTED_FIXED. Назначение не создаётся.',
  })
  requestedContribution?: string | null;
}

export class TemplateApplyCycleDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 28, example: 1 })
  startDay!: number;

  @ApiProperty({ type: Number, minimum: 1, maximum: 27, example: 14 })
  boundaryOffset!: number;
}

export class TemplateApplyRequest {
  @ApiProperty({
    type: String,
    example: 'a'.repeat(64),
    description: 'previewHash из GET preview.',
  })
  previewHash!: string;

  @ApiProperty({
    type: () => TemplateApplyCycleDto,
    required: false,
    description:
      'Смена границ цикла возможна только без подтверждённых фактов, назначений и целей; иначе 409 CYCLE_CHANGE_REQUIRES_FLOW.',
  })
  cycle?: TemplateApplyCycleDto;

  @ApiProperty({
    type: () => [TemplateApplyPeriodDto],
    description: 'Ровно одна запись FIRST и одна SECOND.',
  })
  periods!: TemplateApplyPeriodDto[];

  @ApiProperty({ type: () => TemplateApplyMandatoryDto })
  mandatory!: TemplateApplyMandatoryDto;

  @ApiProperty({
    type: () => [TemplateApplySavingsDto],
    description: 'Только выбранные накопления.',
  })
  savings!: TemplateApplySavingsDto[];
}

export class TemplateAppliedCategoryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  templateKey!: string;

  @ApiProperty({ type: String })
  name!: string;
}

export class TemplateAppliedEnvelopeDto extends TemplateAppliedCategoryDto {
  @ApiProperty({ type: String, enum: ['FIRST', 'SECOND', 'MANDATORY', 'SAVINGS'] })
  role!: string;
}

export class TemplateAdoptedEnvelopeDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, enum: ['FIRST', 'SECOND', 'MANDATORY', 'SAVINGS'] })
  role!: string;

  @ApiProperty({ type: String, nullable: true })
  templateKey!: string | null;

  @ApiProperty({ type: String })
  name!: string;
}

export class TemplateSkippedDto {
  @ApiProperty({ type: String, enum: ['CATEGORY', 'ENVELOPE'] })
  kind!: string;

  @ApiProperty({
    type: String,
    enum: ['FIRST', 'SECOND', 'MANDATORY', 'SAVINGS'],
    nullable: true,
  })
  role!: string | null;

  @ApiProperty({ type: String })
  templateKey!: string;

  @ApiProperty({
    type: String,
    enum: ['USER_SKIPPED', 'COLLISION', 'ARCHIVED', 'NOT_AVAILABLE'],
    description: 'COLLISION/ARCHIVED оставляют шаг шаблона незавершённым.',
  })
  reason!: string;
}

export class TemplateAppliedRuleDto {
  @ApiProperty({ type: String, format: 'uuid' })
  envelopeId!: string;

  @ApiProperty({ type: String, example: 'MANUAL' })
  type!: string;

  @ApiProperty({ type: Number })
  priority!: number;
}

export class TemplateAppliedCycleDto extends TemplateCycleDto {
  @ApiProperty({ type: Boolean })
  changed!: boolean;

  @ApiProperty({
    type: Number,
    description: 'Сколько структурных UNSET/DRAFT периодов было очищено перед перестроением.',
  })
  resetPeriods!: number;
}

export class TemplateAppliedCreatedDto {
  @ApiProperty({ type: () => [TemplateAppliedCategoryDto] })
  categories!: TemplateAppliedCategoryDto[];

  @ApiProperty({ type: () => [TemplateAppliedEnvelopeDto] })
  envelopes!: TemplateAppliedEnvelopeDto[];
}

export class TemplateApplyResponse {
  @ApiProperty({ type: () => TemplateAppliedCreatedDto })
  created!: TemplateAppliedCreatedDto;

  @ApiProperty({ type: () => [TemplateAdoptedEnvelopeDto] })
  adopted!: TemplateAdoptedEnvelopeDto[];

  @ApiProperty({
    type: () => [TemplateSkippedDto],
    description: 'Пропущенные и конфликтующие строки.',
  })
  skipped!: TemplateSkippedDto[];

  @ApiProperty({ type: () => [TemplateAppliedRuleDto], description: 'Только добавленные правила.' })
  rules!: TemplateAppliedRuleDto[];

  @ApiProperty({ type: () => TemplateAppliedCycleDto })
  cycle!: TemplateAppliedCycleDto;

  @ApiProperty({ type: Boolean, description: 'false, если конфликт оставил шаг незавершённым.' })
  isComplete!: boolean;

  @ApiProperty({ type: String, description: 'Новый previewHash после применения.' })
  previewHash!: string;
}
