import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const decimalPattern = '^(0|[1-9]\\d*)(?:\\.\\d+)?$';
const minorPattern = '^-?\\d+$';

export class CreateRegularPlanRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120 })
  name!: string;

  @ApiProperty({ enum: ['INCOME', 'EXPENSE', 'SAVINGS'] })
  planType!: 'INCOME' | 'EXPENSE' | 'SAVINGS';

  @ApiProperty({ type: String, pattern: decimalPattern })
  amount!: string;

  @ApiProperty({ type: String, format: 'date' })
  anchorOn!: string;

  @ApiProperty({ type: String, format: 'date' })
  startOn!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  endOn?: string | null;

  @ApiProperty({ enum: ['ONE_TIME', 'MONTHLY', 'EVERY_N_MONTHS', 'YEARLY'] })
  recurrence!: 'ONE_TIME' | 'MONTHLY' | 'EVERY_N_MONTHS' | 'YEARLY';

  @ApiPropertyOptional({ type: Number, minimum: 2, maximum: 120, nullable: true })
  intervalMonths?: number | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  accountId?: string | null;

  @ApiProperty({ type: String, format: 'uuid' })
  categoryId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  envelopeId?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  comment?: string | null;

  @ApiPropertyOptional({ type: Boolean, default: true })
  isActive?: boolean;
}

export class UpdateRegularPlanRequest {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 120 })
  name?: string;

  @ApiPropertyOptional({ enum: ['INCOME', 'EXPENSE', 'SAVINGS'] })
  planType?: 'INCOME' | 'EXPENSE' | 'SAVINGS';

  @ApiPropertyOptional({ type: String, pattern: decimalPattern })
  amount?: string;

  @ApiPropertyOptional({ type: String, format: 'date' })
  anchorOn?: string;

  @ApiPropertyOptional({ type: String, format: 'date' })
  startOn?: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  endOn?: string | null;

  @ApiPropertyOptional({ enum: ['ONE_TIME', 'MONTHLY', 'EVERY_N_MONTHS', 'YEARLY'] })
  recurrence?: 'ONE_TIME' | 'MONTHLY' | 'EVERY_N_MONTHS' | 'YEARLY';

  @ApiPropertyOptional({ type: Number, minimum: 2, maximum: 120, nullable: true })
  intervalMonths?: number | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  accountId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  categoryId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  envelopeId?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  comment?: string | null;

  @ApiPropertyOptional({ type: Boolean })
  isActive?: boolean;
}

export class RegularPlanResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ enum: ['INCOME', 'EXPENSE', 'SAVINGS'] })
  planType!: 'INCOME' | 'EXPENSE' | 'SAVINGS';

  @ApiProperty({ type: String, pattern: minorPattern })
  amountMinor!: string;

  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ enum: [2] })
  scale!: 2;

  @ApiProperty({ type: String, format: 'date' })
  anchorOn!: string;

  @ApiProperty({ type: String, format: 'date' })
  startOn!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  endOn!: string | null;

  @ApiProperty({ enum: ['ONE_TIME', 'MONTHLY', 'EVERY_N_MONTHS', 'YEARLY'] })
  recurrence!: string;

  @ApiProperty({ type: Number, nullable: true })
  intervalMonths!: number | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  accountId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  categoryId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  envelopeId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: Boolean })
  isActive!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  disabledAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: string | null;
}

export class RegularPlanListResponse {
  @ApiProperty({ type: [RegularPlanResponse] })
  items!: RegularPlanResponse[];
}

export class PlanOccurrenceResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  planId!: string;

  @ApiProperty({ type: String })
  planName!: string;

  @ApiProperty({ enum: ['INCOME', 'EXPENSE', 'SAVINGS'] })
  planType!: 'INCOME' | 'EXPENSE' | 'SAVINGS';

  @ApiProperty({ type: String, format: 'date' })
  scheduledOn!: string;

  @ApiProperty({ enum: ['PENDING', 'DUE', 'SKIPPED', 'COMPLETED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  amountMinor!: string;

  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ enum: [2] })
  scale!: 2;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  accountId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  categoryId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  envelopeId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  transactionId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  cancellationReason!: string | null;
}

export class PlanOccurrenceListResponse {
  @ApiProperty({ type: [PlanOccurrenceResponse] })
  items!: PlanOccurrenceResponse[];
}
