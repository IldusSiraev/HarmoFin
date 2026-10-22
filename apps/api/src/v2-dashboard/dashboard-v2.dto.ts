import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const MONEY = '^-?\\d+$';

export class DashboardV2PeriodResponse {
  @ApiProperty({ type: String, format: 'date' })
  start!: string;

  @ApiProperty({ type: String, format: 'date' })
  end!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Строка текущего периода главного конверта; null, пока период не открыт (например, для VIEWER или при просмотре другой даты).',
  })
  periodId!: string | null;
}

export class DashboardV2SpendableResponse {
  @ApiProperty({
    type: String,
    enum: ['READY', 'NEEDS_PERIOD_SETUP'],
    description: 'NEEDS_PERIOD_SETUP: период ещё не настроен, суммы нет (не показывать 0).',
  })
  state!: 'READY' | 'NEEDS_PERIOD_SETUP';

  @ApiProperty({
    type: String,
    pattern: MONEY,
    nullable: true,
    description:
      'Главное число «Можно потратить» в minor units; защита только по текущему горизонту (просроченные + текущий период), следующий период не вычитается; null при NEEDS_PERIOD_SETUP.',
  })
  amountMinor!: string | null;
}

export class DashboardV2AccountResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  balanceMinor!: string;
}

export class DashboardV2ProtectedAssignmentResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  envelopeId!: string;

  @ApiProperty({ type: String })
  envelopeName!: string;

  @ApiProperty({
    type: String,
    enum: [
      'CURRENT_EXPENSES',
      'MANDATORY_EXPENSES',
      'SAVINGS_GOAL',
      'RESERVE',
      'FREE_MONEY',
      'CUSTOM',
    ],
  })
  envelopeType!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  periodId!: string | null;

  @ApiProperty({ type: String, pattern: MONEY })
  balanceMinor!: string;
}

export class DashboardV2WarningResponse {
  @ApiProperty({ type: String, enum: ['PERIOD', 'COVERAGE'] })
  kind!: 'PERIOD' | 'COVERAGE';

  @ApiProperty({
    type: String,
    enum: ['PERIOD_LEFTOVER', 'PERIOD_DEFICIT', 'MANDATORY_GAP', 'CASH_SHORTFALL'],
  })
  code!: 'PERIOD_LEFTOVER' | 'PERIOD_DEFICIT' | 'MANDATORY_GAP' | 'CASH_SHORTFALL';

  @ApiPropertyOptional({
    type: String,
    enum: ['ALERT', 'INFO'],
    description:
      'Только для MANDATORY_GAP: ALERT, если деньги нужны на текущий период (включая просроченные); INFO, если только на следующий. Прочие предупреждения без этого поля.',
  })
  level?: 'ALERT' | 'INFO';

  @ApiProperty({ type: String, description: 'Текстовый статус с суммой и действием.' })
  message!: string;

  @ApiProperty({ type: String, pattern: '^\\d+$', description: 'Абсолютная сумма в minor units.' })
  amountMinor!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  envelopeId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  periodId!: string | null;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    nullable: true,
    description: 'Знаковый остаток конверта для PERIOD-предупреждений.',
  })
  balanceMinor!: string | null;

  @ApiProperty({ type: String, example: '/app/envelopes?cover=mandatory' })
  actionPath!: string;
}

export class DashboardV2OnboardingResponse {
  @ApiProperty({ type: Boolean })
  categoriesSeeded!: boolean;

  @ApiProperty({ type: Boolean })
  hasAccounts!: boolean;

  @ApiProperty({
    type: Boolean,
    description: 'Есть деньги на счетах, но ни одного подтверждённого назначения.',
  })
  needsOpeningAssignment!: boolean;

  @ApiProperty({ type: Boolean })
  needsPeriodSetup!: boolean;

  @ApiProperty({ type: Boolean })
  hasMandatoryPlans!: boolean;

  @ApiProperty({
    type: Boolean,
    description: 'Владелец указал в онбординге, что обязательных платежей нет.',
  })
  mandatoryPlansDeclined!: boolean;
}

export class DashboardV2UpcomingResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  occurrenceId!: string;

  @ApiProperty({ type: String, format: 'date' })
  scheduledOn!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  unpaidMinor!: string;
}

export class DashboardV2CycleResponse {
  @ApiProperty({ type: String, format: 'date' })
  start!: string;

  @ApiProperty({ type: String, format: 'date' })
  end!: string;
}

export class DashboardV2NearestObligationResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  occurrenceId!: string;

  @ApiProperty({ type: String, description: 'Название обязательного платежа.' })
  name!: string;

  @ApiProperty({ type: String, format: 'date' })
  scheduledOn!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  unpaidMinor!: string;

  @ApiProperty({
    type: String,
    enum: ['COVERED', 'PARTIAL', 'UNCOVERED'],
    description:
      'Покрытие платежа остатком его обязательного конверта: платежи распределяются по сроку, просроченные первыми.',
  })
  coverage!: 'COVERED' | 'PARTIAL' | 'UNCOVERED';

  @ApiProperty({
    type: String,
    pattern: '^\\d+$',
    description: 'Непокрытая часть платежа в minor units.',
  })
  shortfallMinor!: string;
}

export class DashboardV2PeriodStatsResponse {
  @ApiProperty({ type: String, pattern: MONEY, description: 'Потрачено за текущий период.' })
  spentMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description: 'Было доступно: остаток конверта периода плюс потрачено.',
  })
  availableMinor!: string;

  @ApiProperty({
    type: Number,
    format: 'int32',
    description: 'Дней до конца периода, включая сегодняшний.',
  })
  daysLeft!: number;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description:
      '«Можно потратить» на оставшиеся дни, округление вниз до копейки; 0, если тратить нечего.',
  })
  averagePerDayMinor!: string;
}

export class DashboardV2EnvelopeProgressResponse {
  @ApiProperty({
    type: String,
    enum: ['SPENT', 'COVERED', 'GOAL'],
    description:
      'SPENT — потрачено из было доступно в текущем периоде; COVERED — отложено из к оплате до конца горизонта; GOAL — накоплено из цели.',
  })
  kind!: 'SPENT' | 'COVERED' | 'GOAL';

  @ApiProperty({ type: String, pattern: '^\\d+$', description: 'Текущее значение в minor units.' })
  valueMinor!: string;

  @ApiProperty({
    type: String,
    pattern: '^\\d+$',
    description: 'Полное значение шкалы в minor units (> 0).',
  })
  maxMinor!: string;

  @ApiProperty({
    type: String,
    pattern: '^\\d+$',
    nullable: true,
    description: 'Только для COVERED: сколько не хватает до суммы к оплате; иначе null.',
  })
  shortfallMinor!: string | null;
}

export class DashboardV2EnvelopeResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({
    type: String,
    enum: [
      'CURRENT_EXPENSES',
      'MANDATORY_EXPENSES',
      'SAVINGS_GOAL',
      'RESERVE',
      'FREE_MONEY',
      'CUSTOM',
    ],
  })
  envelopeType!: string;

  @ApiProperty({ type: String, enum: ['FIRST', 'SECOND'], nullable: true })
  periodSlot!: 'FIRST' | 'SECOND' | null;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description: 'Остаток конверта по всем периодам.',
  })
  balanceMinor!: string;

  @ApiProperty({
    type: DashboardV2EnvelopeProgressResponse,
    nullable: true,
    description:
      'Шкала конверта для дашборда; null, если шкалы нет (нет цели, платежей или периода).',
  })
  progress!: DashboardV2EnvelopeProgressResponse | null;
}

export class DashboardV2Response {
  @ApiProperty({ type: Number, enum: [2] })
  planModelVersion!: 2;

  @ApiProperty({ type: DashboardV2PeriodResponse })
  period!: DashboardV2PeriodResponse;

  @ApiProperty({
    type: DashboardV2CycleResponse,
    description: 'Финансовый месяц (цикл), содержащий дату расчёта.',
  })
  cycle!: DashboardV2CycleResponse;

  @ApiProperty({
    type: String,
    format: 'date',
    description: 'Дата расчёта: сегодня в часовом поясе бюджета или переданный asOf.',
  })
  asOf!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    description:
      'Конец горизонта расчёта и прогноза (конец следующего периода); защита «Можно потратить» действует только до конца текущего периода (просроченные + текущий).',
  })
  horizonEnd!: string;

  @ApiProperty({ type: DashboardV2SpendableResponse })
  spendable!: DashboardV2SpendableResponse;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    nullable: true,
    description: 'Предложенная цель периода (DRAFT), если период ещё не настроен.',
  })
  suggestedTarget!: string | null;

  @ApiProperty({ type: String, pattern: MONEY, description: 'На счетах.' })
  cashMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY, description: 'Остаток текущего периода.' })
  currentBalanceMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  mandatoryBalanceMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  mandatoryDueMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description:
      'Из mandatoryDueMinor: платежи со сроком не позже конца текущего периода — входят в горизонт защиты.',
  })
  mandatoryDueCurrentMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description:
      'Остаток mandatoryDueMinor: платежи следующего периода — прогноз, не входят в горизонт защиты.',
  })
  mandatoryDueNextMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  otherProtectedMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description:
      'Отложено на обязательные платежи (не меньше нуля) и накопления/прочие конверты вне текущего периода.',
  })
  protectedMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  freeToAssignMinor!: string;

  @ApiProperty({ type: String, pattern: MONEY })
  unbackedMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description:
      'Непокрытая часть обязательных платежей текущего горизонта (просроченные + текущий период); следующий период не входит.',
  })
  mandatoryGapMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description:
      'Непокрытая часть обязательных платежей текущего горизонта (просроченные + текущий период); следующий период не входит.',
  })
  mandatoryGapCurrentMinor!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description:
      'Непокрытая часть обязательных платежей следующего периода; прогноз, не входит в «Можно потратить» и не входит в горизонт защиты.',
  })
  mandatoryGapNextMinor!: string;

  @ApiProperty({
    type: Boolean,
    description:
      'true для VIEWER или когда asOf вне текущего периода: «к оплате» может быть неполным.',
  })
  dueMayBeIncomplete!: boolean;

  @ApiProperty({ type: [DashboardV2UpcomingResponse] })
  upcoming!: DashboardV2UpcomingResponse[];

  @ApiProperty({
    type: [DashboardV2NearestObligationResponse],
    description: 'Три ближайших неоплаченных обязательных платежа в пределах 60 дней.',
  })
  nearestObligations!: DashboardV2NearestObligationResponse[];

  @ApiProperty({
    type: DashboardV2PeriodStatsResponse,
    nullable: true,
    description: 'null, пока лимит периода не настроен.',
  })
  periodStats!: DashboardV2PeriodStatsResponse | null;

  @ApiProperty({ type: [DashboardV2EnvelopeResponse] })
  envelopes!: DashboardV2EnvelopeResponse[];

  @ApiProperty({
    type: String,
    pattern: MONEY,
    description:
      'Сумма остатков показанных конвертов; деньги, ещё не назначенные конвертам (freeToAssignMinor), в неё не входят.',
  })
  envelopesTotalMinor!: string;

  @ApiProperty({ type: [DashboardV2AccountResponse] })
  accounts!: DashboardV2AccountResponse[];

  @ApiProperty({ type: [DashboardV2ProtectedAssignmentResponse] })
  protectedAssignments!: DashboardV2ProtectedAssignmentResponse[];

  @ApiProperty({ type: [DashboardV2WarningResponse] })
  warnings!: DashboardV2WarningResponse[];

  @ApiProperty({ type: DashboardV2OnboardingResponse })
  onboarding!: DashboardV2OnboardingResponse;
}
