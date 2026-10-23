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

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 128,
    description:
      'Идентификатор строки из preview: точное совпадение с серверной строкой. Свободная форма; строка без совпадения добавляется как новая.',
  })
  lineId?: string;
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
    maxItems: 100,
    description:
      'Строки пользователя заменяют или дополняют предложение; сервер пересчитывает остаток и ошибки без записи. previewHash годится для confirm, только если lines подтверждения равны этим overrides. Сумма 0 убирает строку, а confirm отклоняет 0 кодом 400.',
  })
  overrides?: FundingPreviewOverrideDto[];

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'string', format: 'uuid' },
    maxItems: 100,
    description:
      'Периоды с предложенной целью DRAFT, выбранные для подтверждения. Не указано — выбраны все; пустой список — не выбран ни один (условные строки периодов не предлагаются). previewHash годится для confirm, только если confirmPeriodTargets подтверждения равны этому выбору.',
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

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 128,
    nullable: true,
    example: '{envelopeId}||MANDATORY_CURRENT',
    description:
      'Идентификатор строки: точное совпадение при overrides и confirm. Обязательным слайсам сервер присваивает канонические id; прочие строки — null.',
  })
  lineId?: string | null;

  @ApiProperty({
    type: String,
    example: '4000000',
    description: 'Предложенная или введённая сумма в копейках; "0" — конверт в списке без суммы.',
  })
  suggestedMinor!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1,
    description:
      'Номер строки в очереди правил пополнения (с 1); null — у конверта нет правила в очереди.',
  })
  queuePosition!: number | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: 'Начало периода строки; null для конверта без периодов.',
  })
  periodStartsOn!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: 'Конец периода строки; null для конверта без периодов.',
  })
  periodEndsOn!: string | null;
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
    example: '3000000',
    description: 'Обязательные платежи в срезе asOf..cycleEndInclusive — текущий период, minor.',
  })
  mandatoryDueCurrentMinor!: string;

  @ApiProperty({
    type: String,
    example: '1000000',
    description:
      'Обязательные платежи в срезе cycleEndExclusive..nextPeriodEndInclusive — следующий период, minor.',
  })
  mandatoryDueNextMinor!: string;

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

export class FundingConfirmLineDto {
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
    description:
      'Сумма в рублях ≥ 0: десятичная строка, до 2 знаков. Строка с 0 участвует в проверке previewHash, но назначения не создаёт.',
  })
  amount!: string;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 128,
    description:
      'Идентификатор строки из preview: точное совпадение. Без него сервер сопоставляет строку по envelopeId/periodId; обязательная строка с несовпавшим id — 400.',
  })
  lineId?: string;
}

export class FundingConfirmRequest {
  @ApiProperty({ type: String, enum: ['INCOME', 'OPENING', 'FREE'], example: 'INCOME' })
  sourceKind!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    maxLength: 36,
    description: 'Обязателен для INCOME, недопустим для остальных источников.',
  })
  incomeTransactionId?: string;

  @ApiProperty({
    type: String,
    minLength: 64,
    maxLength: 64,
    description:
      'previewHash предпросмотра, выполненного с overrides = lines и confirmPeriodTargets этого запроса. Расхождение состояния — 409 PREVIEW_STALE без записи.',
  })
  previewHash!: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'uuid' },
    maxItems: 100,
    description:
      'Периоды с целью DRAFT, подтверждаемые в той же транзакции. Пустой список — цели не подтверждаются.',
  })
  confirmPeriodTargets!: string[];

  @ApiProperty({
    type: () => [FundingConfirmLineDto],
    maxItems: 100,
    description:
      'Назначения. Пустой список допустим: деньги остаются свободными, подтверждаются только цели.',
  })
  lines!: FundingConfirmLineDto[];
}

export class FundingConfirmAssignmentDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  envelopeId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  periodId!: string | null;

  @ApiProperty({ type: String, example: '700000' })
  amountMinor!: string;
}

export class FundingConfirmResponse {
  @ApiProperty({ type: String, example: '7000000', description: 'Назначено всего, minor.' })
  assignedMinor!: string;

  @ApiProperty({ type: String, example: '1000000', description: 'Остаток источника, minor.' })
  sourceRemainingMinor!: string;

  @ApiProperty({ type: [String], description: 'Подтверждённые периоды целей.' })
  confirmedPeriodIds!: string[];

  @ApiProperty({ type: () => [FundingConfirmAssignmentDto] })
  assignments!: FundingConfirmAssignmentDto[];
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
