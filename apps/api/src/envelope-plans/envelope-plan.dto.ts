import { ApiProperty } from '@nestjs/swagger';

export class EnvelopePlanResponse {
  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  id!: string;

  @ApiProperty({ example: 'Резерв' })
  name!: string;

  @ApiProperty({
    enum: ['CURRENT_EXPENSES', 'MANDATORY_EXPENSES', 'SAVINGS_GOAL', 'RESERVE', 'CUSTOM'],
    example: 'RESERVE',
  })
  envelopeType!: string;

  @ApiProperty({ nullable: true, enum: ['FIRST', 'SECOND'], example: null })
  periodSlot!: string | null;

  @ApiProperty({ nullable: true, example: '5000.00' })
  targetAmountMinor!: string | null;

  @ApiProperty({ nullable: true, example: 'Семейный резерв' })
  comment!: string | null;

  @ApiProperty({ example: '12000' })
  fundedMinor!: string;

  @ApiProperty({ example: '2000' })
  spentMinor!: string;

  @ApiProperty({ example: '10000' })
  balanceMinor!: string;

  @ApiProperty({ nullable: true, example: '2026-09-30T12:00:00.000Z' })
  archivedAt!: string | null;
}

export class EnvelopePlanListResponse {
  @ApiProperty({ type: [EnvelopePlanResponse] })
  items!: EnvelopePlanResponse[];
}

export class CreateEnvelopeRequest {
  @ApiProperty({ example: 'Резерв' })
  name!: string;

  @ApiProperty({
    enum: ['CURRENT_EXPENSES', 'MANDATORY_EXPENSES', 'SAVINGS_GOAL', 'RESERVE', 'CUSTOM'],
    example: 'RESERVE',
  })
  envelopeType!: string;

  @ApiProperty({ required: false, enum: ['FIRST', 'SECOND'] })
  periodSlot?: string;

  @ApiProperty({ required: false, example: '5000.00' })
  targetAmountMinor?: string;

  @ApiProperty({ required: false, example: 'Семейный резерв' })
  comment?: string;
}

export class UpdateEnvelopeRequest {
  @ApiProperty({ required: false, example: 'Резерв 2' })
  name?: string;

  @ApiProperty({ required: false, enum: ['FIRST', 'SECOND'] })
  periodSlot?: string;
}

export class CreateAssignmentRequest {
  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  envelopeId!: string;

  @ApiProperty({ required: false, example: '0195f3c3-aaaa-bbbb-cccc-000000000002' })
  incomeTransactionId?: string;

  @ApiProperty({ required: false, example: '0195f3c3-aaaa-bbbb-cccc-000000000003' })
  periodId?: string;

  @ApiProperty({ example: '100.00' })
  amount!: string;

  @ApiProperty({ required: false, enum: ['OPENING', 'FREE', 'INCOME'], example: 'FREE' })
  sourceKind?: string;
}

export class ReviseAssignmentRequest {
  @ApiProperty({ example: '250.00' })
  amount!: string;
}

export class MoveEnvelopeRequest {
  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  sourceEnvelopeId!: string;

  @ApiProperty({ required: false, example: '0195f3c3-aaaa-bbbb-cccc-000000000003' })
  sourcePeriodId?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Конверт-получатель; null — возврат средств в свободные наличные.',
  })
  destinationEnvelopeId?: string | null;

  @ApiProperty({ required: false })
  destinationPeriodId?: string;

  @ApiProperty({ example: '100.00' })
  amount!: string;
}

export class EnvelopeHistoryItemResponse {
  @ApiProperty({ enum: ['ASSIGNMENT', 'MOVEMENT', 'SPENDING'], example: 'MOVEMENT' })
  kind!: string;

  @ApiProperty({ example: '10000' })
  amountMinor!: string;

  @ApiProperty({ format: 'date', example: '2026-09-30' })
  effectiveOn!: string;
}

export class EnvelopeHistoryListResponse {
  @ApiProperty({ type: [EnvelopeHistoryItemResponse] })
  items!: EnvelopeHistoryItemResponse[];

  @ApiProperty({ nullable: true, example: null })
  nextCursor!: string | null;
}
