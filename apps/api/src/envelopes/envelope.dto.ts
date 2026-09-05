import { ApiProperty } from '@nestjs/swagger';

const envelopeTypes = [
  'CURRENT_EXPENSES',
  'MANDATORY_EXPENSES',
  'SAVINGS_GOAL',
  'RESERVE',
  'FREE_MONEY',
  'CUSTOM',
];

export class CreateEnvelopeRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120 })
  name!: string;

  @ApiProperty({ enum: envelopeTypes })
  envelopeType!: string;

  @ApiProperty({ enum: ['FIRST', 'SECOND'], nullable: true, required: false })
  periodSlot?: 'FIRST' | 'SECOND' | null;

  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: String, pattern: '^[+-]?(0|[1-9]\\d*)(?:\\.\\d+)?$' })
  startingBalance!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    pattern: '^[+-]?(0|[1-9]\\d*)(?:\\.\\d+)?$',
  })
  monthlyPlannedAmount?: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    pattern: '^[+-]?(0|[1-9]\\d*)(?:\\.\\d+)?$',
  })
  targetAmount?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, format: 'date' })
  targetDate?: string | null;

  @ApiProperty({ type: Number, minimum: 0, maximum: 1_000_000 })
  displayOrder!: number;

  @ApiProperty({ type: String, nullable: true, required: false, maxLength: 500 })
  comment?: string | null;
}

export class UpdateEnvelopeRequest {
  @ApiProperty({ type: String, required: false, minLength: 1, maxLength: 120 })
  name?: string;

  @ApiProperty({ enum: envelopeTypes, required: false })
  envelopeType?: string;

  @ApiProperty({ enum: ['FIRST', 'SECOND'], nullable: true, required: false })
  periodSlot?: 'FIRST' | 'SECOND' | null;

  @ApiProperty({ type: String, required: false, pattern: '^[+-]?(0|[1-9]\\d*)(?:\\.\\d+)?$' })
  startingBalance?: string;

  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    pattern: '^[+-]?(0|[1-9]\\d*)(?:\\.\\d+)?$',
  })
  monthlyPlannedAmount?: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    pattern: '^[+-]?(0|[1-9]\\d*)(?:\\.\\d+)?$',
  })
  targetAmount?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, format: 'date' })
  targetDate?: string | null;

  @ApiProperty({ type: Number, required: false, minimum: 0, maximum: 1_000_000 })
  displayOrder?: number;

  @ApiProperty({ type: String, nullable: true, required: false, maxLength: 500 })
  comment?: string | null;
}

export class EnvelopeResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ type: String, nullable: true })
  templateKey!: string | null;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ enum: envelopeTypes })
  envelopeType!: string;

  @ApiProperty({ enum: ['FIRST', 'SECOND'], nullable: true })
  periodSlot!: 'FIRST' | 'SECOND' | null;

  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: Number, enum: [2] })
  scale!: 2;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  startingBalanceMinor!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  currentBalanceMinor!: string;

  @ApiProperty({ type: String, nullable: true, pattern: '^\\d+$' })
  monthlyPlannedAmountMinor!: string | null;

  @ApiProperty({ type: String, nullable: true, pattern: '^\\d+$' })
  targetAmountMinor!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  targetDate!: string | null;

  @ApiProperty({ type: Number })
  displayOrder!: number;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  archivedAt!: string | null;
}
