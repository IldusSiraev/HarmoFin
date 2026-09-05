import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const decimalPattern = '^(0|[1-9]\\d*)(?:\\.\\d+)?$';
const minorPattern = '^-?\\d+$';

export class CreateTransferPartRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  sourceEnvelopeId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  destinationEnvelopeId?: string;

  @ApiProperty({ type: String, pattern: decimalPattern })
  amount!: string;

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  comment?: string | null;
}

export class CreateTransferRequest {
  @ApiPropertyOptional({ enum: ['DRAFT', 'CONFIRMED'], default: 'DRAFT' })
  status?: 'DRAFT' | 'CONFIRMED';

  @ApiProperty({ type: String, pattern: decimalPattern })
  total!: string;

  @ApiProperty({ type: String, format: 'date' })
  occurredOn!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  sourceAccountId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  destinationAccountId!: string;

  @ApiProperty({ type: [CreateTransferPartRequest], minItems: 1, maxItems: 100 })
  parts!: CreateTransferPartRequest[];

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  comment?: string | null;
}

export class TransferPartResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  transferId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  sourceAccountId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  destinationAccountId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  sourceEnvelopeId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  destinationEnvelopeId!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  amountMinor!: string;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, pattern: minorPattern })
  sourceAccountCurrentBalanceMinor!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  destinationAccountCurrentBalanceMinor!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  sourceEnvelopeCurrentBalanceMinor!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  destinationEnvelopeCurrentBalanceMinor!: string;
}

export class TransferResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ enum: ['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED'] })
  status!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  totalMinor!: string;

  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: Number, enum: [2] })
  scale!: 2;

  @ApiProperty({ type: String, format: 'date' })
  occurredOn!: string;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  confirmedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  cancelledAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  deletedAt!: string | null;

  @ApiProperty({ type: [TransferPartResponse] })
  parts!: TransferPartResponse[];
}

export class TransferListResponse {
  @ApiProperty({ type: [TransferResponse] })
  items!: TransferResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
