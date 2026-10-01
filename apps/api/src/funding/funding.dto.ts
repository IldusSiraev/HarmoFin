import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FundingPreviewOverrideDto {
  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  envelopeId!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    maxLength: 36,
    description: 'Обязателен для периодных конвертов.',
  })
  periodId?: string;

  @ApiProperty({
    type: String,
    example: '7000.00',
    description: 'Сумма строки: десятичная строка, до 2 знаков; 0 убирает строку.',
  })
  amount!: string;
}

export class FundingPreviewRequest {
  @ApiProperty({ type: String, enum: ['INCOME', 'OPENING', 'FREE'], example: 'INCOME' })
  sourceKind!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    maxLength: 36,
    description: 'Обязателен для INCOME, недопустим для остальных источников.',
  })
  incomeTransactionId?: string;

  @ApiPropertyOptional({
    type: () => [FundingPreviewOverrideDto],
    description:
      'Строки пользователя заменяют или дополняют предложение; сервер пересчитывает остаток и ошибки без записи.',
  })
  overrides?: FundingPreviewOverrideDto[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Периоды с предложенной целью DRAFT, выбранные для подтверждения. Не указано — выбраны все; пустой список — не выбран ни один (условные строки периодов не предлагаются).',
  })
  confirmPeriodTargets?: string[];
}

export class FundingPeriodTargetDraftDto {
  @ApiProperty({ type: String, format: 'uuid' })
  periodId!: string;

  @ApiProperty({
    type: String,
    example: '6500000',
    description: 'Предложенная цель в minor units.',
  })
  targetMinor!: string;

  @ApiProperty({ type: Boolean, example: true })
  selectedForConfirmation!: boolean;
}

export class FundingPreviewLineDto {
  @ApiProperty({ type: String, format: 'uuid' })
  envelopeId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  periodId!: string | null;

  @ApiProperty({ type: String, example: '4000000' })
  suggestedMinor!: string;
}

export class FundingPreviewErrorDto {
  @ApiProperty({ type: String, example: 'OVERRIDES_EXCEED_SOURCE' })
  code!: string;

  @ApiProperty({ type: String })
  detail!: string;
}

export class FundingPreviewResponse {
  @ApiProperty({ type: String, enum: ['INCOME', 'OPENING', 'FREE'] })
  sourceKind!: string;

  @ApiProperty({ type: String, example: '8000000', description: 'Доступно из источника, minor.' })
  sourceAvailableMinor!: string;

  @ApiProperty({ type: () => [FundingPeriodTargetDraftDto] })
  periodTargetDrafts!: FundingPeriodTargetDraftDto[];

  @ApiProperty({ type: () => [FundingPreviewLineDto] })
  lines!: FundingPreviewLineDto[];

  @ApiProperty({ type: String, example: '0' })
  remainingMinor!: string;

  @ApiProperty({
    type: String,
    example: '4000000',
    description: 'Нехватка на обязательства по горизонту; показывается всегда.',
  })
  mandatoryGapMinor!: string;

  @ApiProperty({
    type: String,
    minLength: 64,
    maxLength: 64,
    description: 'sha256 состояния источника, балансов, правил, выбора и строк пользователя.',
  })
  previewHash!: string;

  @ApiProperty({ type: () => [FundingPreviewErrorDto] })
  errors!: FundingPreviewErrorDto[];
}

export class IncomeCategorySuggestionRequest {
  @ApiProperty({ type: Boolean, example: true })
  enabled!: boolean;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Активная категория дохода этого бюджета.',
  })
  sourceCategoryId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Активный конверт этого бюджета.',
  })
  targetEnvelopeId!: string | null;
}

export class IncomeCategorySuggestionResponse {
  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  sourceCategoryId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  targetEnvelopeId!: string | null;
}
