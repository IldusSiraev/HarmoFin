import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import { PersonRefResponse } from '../common/people/person-ref.dto.js';

export class EnvelopePeriodBalanceResponse {
  @ApiProperty({
    type: String,
    description: 'Идентификатор периода конверта; передаётся как sourcePeriodId/periodId.',
    example: '0195f3c3-aaaa-bbbb-cccc-000000000003',
  })
  periodId!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-09-25' })
  startsOn!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-09' })
  endsOn!: string;

  @ApiProperty({ type: String, example: '1000000' })
  fundedMinor!: string;

  @ApiProperty({ type: String, example: '200000' })
  spentMinor!: string;

  @ApiProperty({ type: String, example: '800000' })
  balanceMinor!: string;

  @ApiProperty({
    type: Boolean,
    description: 'Сегодняшняя дата по часовому поясу бюджета попадает в этот период.',
    example: true,
  })
  current!: boolean;
}

export class EnvelopePlanResponse {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  id!: string;

  @ApiProperty({ type: String, example: 'Резерв' })
  name!: string;

  @ApiProperty({
    type: String,
    enum: ['CURRENT_EXPENSES', 'MANDATORY_EXPENSES', 'SAVINGS_GOAL', 'RESERVE', 'CUSTOM'],
    example: 'RESERVE',
  })
  envelopeType!: string;

  @ApiProperty({ type: String, nullable: true, enum: ['FIRST', 'SECOND'], example: null })
  periodSlot!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '5000.00' })
  targetAmountMinor!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Семейный резерв' })
  comment!: string | null;

  @ApiProperty({ type: String, example: '12000' })
  fundedMinor!: string;

  @ApiProperty({ type: String, example: '2000' })
  spentMinor!: string;

  @ApiProperty({ type: String, example: '10000' })
  balanceMinor!: string;

  @ApiProperty({ type: String, nullable: true, example: '2026-09-30T12:00:00.000Z' })
  archivedAt!: string | null;

  @ApiProperty({
    type: [EnvelopePeriodBalanceResponse],
    description:
      'Периоды периодного конверта, в которых есть движение денег, и текущий период; ' +
      'по возрастанию даты начала. Для конвертов без периодов — пустой список.',
  })
  periods!: EnvelopePeriodBalanceResponse[];

  @ApiProperty({ type: PersonRefResponse })
  owner!: PersonRefResponse;

  @ApiProperty({
    type: Boolean,
    description:
      'Подсказка для интерфейса: текущий пользователь может изменять конверт. Право проверяет сервер.',
  })
  canEdit!: boolean;
}

export class AssignmentResultResponse {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000010' })
  assignmentId!: string;

  @ApiProperty({ type: String, example: '10000' })
  amountMinor!: string;

  @ApiProperty({ type: String, example: '12000' })
  fundedMinor!: string;

  @ApiProperty({ type: String, example: '2000' })
  spentMinor!: string;

  @ApiProperty({ type: String, example: '10000' })
  balanceMinor!: string;

  @ApiProperty({ type: String, example: '0' })
  freeToAssignMinor!: string;
}

export class MovementResultResponse {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000020' })
  movementId!: string;

  @ApiProperty({ type: String, example: '10000' })
  amountMinor!: string;

  @ApiProperty({ type: String, example: '5000' })
  sourceBalanceMinor!: string;

  @ApiProperty({ type: String, nullable: true, example: '15000' })
  destinationBalanceMinor!: string | null;

  @ApiProperty({ type: String, example: '30000000' })
  cashMinor!: string;
}

export class EnvelopePlanListResponse {
  @ApiProperty({ type: [EnvelopePlanResponse] })
  items!: EnvelopePlanResponse[];
}

@ApiSchema({ name: 'CreateEnvelopePlanRequest' })
export class CreateEnvelopeRequest {
  @ApiProperty({ type: String, example: 'Резерв' })
  name!: string;

  @ApiProperty({
    type: String,
    enum: ['CURRENT_EXPENSES', 'MANDATORY_EXPENSES', 'SAVINGS_GOAL', 'RESERVE', 'CUSTOM'],
    example: 'RESERVE',
  })
  envelopeType!: string;

  @ApiProperty({ type: String, required: false, enum: ['FIRST', 'SECOND'] })
  periodSlot?: string;

  @ApiProperty({ type: String, required: false, example: '5000.00' })
  targetAmountMinor?: string;

  @ApiProperty({ type: String, required: false, example: 'Семейный резерв' })
  comment?: string;
}

export class PutFundingRuleRequest {
  @ApiProperty({
    type: String,
    enum: ['MANUAL', 'SUM_OF_PLANS', 'FIXED_PER_PERIOD', 'SUGGESTED_FIXED', 'PERCENT_OF_INCOME'],
    example: 'FIXED_PER_PERIOD',
  })
  type!: string;

  @ApiProperty({ type: Number, example: 10, minimum: 0, maximum: 1000000 })
  priority!: number;

  @ApiProperty({
    type: String,
    required: false,
    example: '65000.00',
    description: 'Только FIXED_PER_PERIOD и SUGGESTED_FIXED; обязателен для них.',
  })
  fixedAmount?: string;

  @ApiProperty({
    type: Number,
    required: false,
    example: 3000,
    minimum: 0,
    maximum: 10000,
    description: 'Только PERCENT_OF_INCOME; обязателен для него.',
  })
  percentBasisPoints?: number;
}

export class FundingRuleResponse {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000010' })
  id!: string;

  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  envelopeId!: string;

  @ApiProperty({
    type: String,
    enum: ['MANUAL', 'SUM_OF_PLANS', 'FIXED_PER_PERIOD', 'SUGGESTED_FIXED', 'PERCENT_OF_INCOME'],
    example: 'FIXED_PER_PERIOD',
  })
  type!: string;

  @ApiProperty({ type: Number, example: 10 })
  priority!: number;

  @ApiProperty({ type: String, nullable: true, example: '6500000' })
  fixedAmountMinor!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  percentBasisPoints!: number | null;
}

export class FundingRuleListResponse {
  @ApiProperty({ type: [FundingRuleResponse] })
  items!: FundingRuleResponse[];
}

export class PutPeriodTargetRequest {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '65000.00',
    description: 'Подтверждаемая сумма периода; null сбрасывает цель в UNSET. Поле обязательно.',
  })
  target!: string | null;
}

export class PeriodTargetResponse {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000020' })
  periodId!: string;

  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  envelopeId!: string;

  @ApiProperty({ type: String, example: '2026-09-01' })
  periodStart!: string;

  @ApiProperty({ type: String, example: '2026-09-14' })
  periodEnd!: string;

  @ApiProperty({ type: String, nullable: true, example: '6500000' })
  targetMinor!: string | null;

  @ApiProperty({
    type: String,
    enum: ['UNSET', 'DRAFT', 'CONFIRMED'],
    example: 'CONFIRMED',
    description: 'Только CONFIRMED считается действующей целью периода.',
  })
  targetStatus!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '6500000',
    description: 'Предложенная (DRAFT) цель; null, если цель не в статусе DRAFT.',
  })
  suggestedTargetMinor!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '6500000',
    description: 'Подтверждённая цель; null, если цель не CONFIRMED.',
  })
  confirmedTargetMinor!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2026-09-01T09:00:00.000Z' })
  confirmedAt!: string | null;
}

@ApiSchema({ name: 'UpdateEnvelopePlanRequest' })
export class UpdateEnvelopeRequest {
  @ApiProperty({ type: String, required: false, example: 'Резерв 2' })
  name?: string;

  @ApiProperty({ type: String, required: false, enum: ['FIRST', 'SECOND'] })
  periodSlot?: string;
}

export class CreateAssignmentRequest {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  envelopeId!: string;

  @ApiProperty({ type: String, required: false, example: '0195f3c3-aaaa-bbbb-cccc-000000000002' })
  incomeTransactionId?: string;

  @ApiProperty({ type: String, required: false, example: '0195f3c3-aaaa-bbbb-cccc-000000000003' })
  periodId?: string;

  @ApiProperty({ type: String, example: '100.00' })
  amount!: string;

  @ApiProperty({
    type: String,
    required: false,
    enum: ['OPENING', 'FREE', 'INCOME'],
    example: 'FREE',
  })
  sourceKind?: string;
}

export class ReviseAssignmentRequest {
  @ApiProperty({ type: String, example: '250.00' })
  amount!: string;
}

export class MoveEnvelopeRequest {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  sourceEnvelopeId!: string;

  @ApiProperty({ type: String, required: false, example: '0195f3c3-aaaa-bbbb-cccc-000000000003' })
  sourcePeriodId?: string;

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    description: 'Конверт-получатель; null — возврат средств в свободные наличные.',
  })
  destinationEnvelopeId?: string | null;

  @ApiProperty({ type: String, required: false })
  destinationPeriodId?: string;

  @ApiProperty({ type: String, example: '100.00' })
  amount!: string;
}

export class EnvelopeHistoryItemResponse {
  @ApiProperty({ type: String, enum: ['ASSIGNMENT', 'MOVEMENT', 'SPENDING'], example: 'MOVEMENT' })
  kind!: string;

  @ApiProperty({ type: String, example: '10000' })
  amountMinor!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-09-30' })
  effectiveOn!: string;

  @ApiProperty({ type: String, enum: ['IN', 'OUT'], example: 'OUT' })
  direction!: string;

  @ApiProperty({ type: PersonRefResponse })
  createdBy!: PersonRefResponse;

  @ApiProperty({ type: String, nullable: true, example: 'Отпуск' })
  counterpartName!: string | null;

  @ApiProperty({ type: String, nullable: true, enum: ['INCOME', 'OPENING', 'FREE'], example: 'INCOME' })
  assignmentType!: string | null;
}

export class EnvelopeHistoryListResponse {
  @ApiProperty({ type: [EnvelopeHistoryItemResponse] })
  items!: EnvelopeHistoryItemResponse[];

  @ApiProperty({ type: String, nullable: true, example: null })
  nextCursor!: string | null;
}

const RULE_TYPES = [
  'MANUAL',
  'SUM_OF_PLANS',
  'FIXED_PER_PERIOD',
  'SUGGESTED_FIXED',
  'PERCENT_OF_INCOME',
];

export class FundingRulesBatchQueueItem {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  envelopeId!: string;

  @ApiProperty({
    type: String,
    enum: RULE_TYPES.filter((type) => type !== 'MANUAL'),
    example: 'PERCENT_OF_INCOME',
  })
  type!: string;

  @ApiProperty({
    type: String,
    required: false,
    example: '15000.00',
    description: 'Только FIXED_PER_PERIOD и SUGGESTED_FIXED; обязателен для них.',
  })
  fixedAmount?: string;

  @ApiProperty({
    type: Number,
    required: false,
    example: 1000,
    minimum: 0,
    maximum: 10000,
    description: 'Только PERCENT_OF_INCOME; обязателен для него.',
  })
  percentBasisPoints?: number;
}

export class FundingRulesBatchOutsideItem {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000002' })
  envelopeId!: string;

  @ApiProperty({ type: String, enum: ['MANUAL'], example: 'MANUAL' })
  type!: string;
}

export class IncomeSuggestionState {
  @ApiProperty({ type: Boolean, example: false })
  enabled!: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  sourceCategoryId!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  targetEnvelopeId!: string | null;
}

export class PutFundingRulesBatchRequest {
  @ApiProperty({
    type: [FundingRulesBatchQueueItem],
    description:
      'Очередь распределения: порядок массива = порядок. priority присваивает сервер: (индекс + 1) * 10.',
  })
  queue!: FundingRulesBatchQueueItem[];

  @ApiProperty({
    type: [FundingRulesBatchOutsideItem],
    description: 'Конверты вне очереди (MANUAL, priority 0).',
  })
  outside!: FundingRulesBatchOutsideItem[];

  @ApiProperty({ type: IncomeSuggestionState })
  incomeSuggestion!: IncomeSuggestionState;
}

export class FundingRulesBatchResponse {
  @ApiProperty({ type: [FundingRuleResponse] })
  items!: FundingRuleResponse[];

  @ApiProperty({ type: IncomeSuggestionState })
  incomeSuggestion!: IncomeSuggestionState;
}
