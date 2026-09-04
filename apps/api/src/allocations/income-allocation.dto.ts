import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const decimalPattern = '^(0|[1-9]\\d*)(?:\\.\\d+)?$';
const minorPattern = '^-?\\d+$';

export class CreateIncomeAllocationRequest {
  @ApiProperty({ type: String, pattern: decimalPattern })
  amount!: string;

  @ApiProperty({ type: String, format: 'date' })
  occurredOn!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  accountId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  envelopeId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  comment?: string | null;
}

export class UpdateIncomeAllocationRequest {
  @ApiPropertyOptional({ type: String, pattern: decimalPattern })
  amount?: string;

  @ApiPropertyOptional({ type: String, format: 'date' })
  occurredOn?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  accountId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  envelopeId?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  comment?: string | null;
}

export class IncomeAllocationResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  incomeTransactionId!: string;

  @ApiProperty({ enum: ['CONFIRMED', 'CANCELLED', 'DELETED'] })
  status!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  amountMinor!: string;

  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: Number, enum: [2] })
  scale!: 2;

  @ApiProperty({ type: String, format: 'date' })
  occurredOn!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  accountId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  envelopeId!: string;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  deletedAt!: string | null;

  @ApiProperty({ type: String, pattern: minorPattern })
  remainingUnallocatedMinor!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  envelopeCurrentBalanceMinor!: string;
}
