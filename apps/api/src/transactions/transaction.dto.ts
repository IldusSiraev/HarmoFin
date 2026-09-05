import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const decimalPattern = '^(0|[1-9]\\d*)(?:\\.\\d+)?$';
const minorPattern = '^-?\\d+$';

export class CreateTransactionRequest {
  @ApiProperty({ enum: ['INCOME', 'EXPENSE'] })
  transactionType!: 'INCOME' | 'EXPENSE';

  @ApiPropertyOptional({ enum: ['DRAFT', 'CONFIRMED'], default: 'DRAFT' })
  status?: 'DRAFT' | 'CONFIRMED';

  @ApiProperty({ type: String, pattern: decimalPattern })
  amount!: string;

  @ApiProperty({ type: String, format: 'date' })
  occurredOn!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  accountId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  categoryId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  envelopeId?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 250, nullable: true })
  sourceDescription?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 250, nullable: true })
  merchantName?: string | null;

  @ApiPropertyOptional({ type: Boolean, default: false })
  isPlanned?: boolean;

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  comment?: string | null;
}

export class UpdateTransactionRequest {
  @ApiPropertyOptional({ type: String, pattern: decimalPattern })
  amount?: string;

  @ApiPropertyOptional({ type: String, format: 'date' })
  occurredOn?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  accountId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  categoryId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  envelopeId?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 250, nullable: true })
  sourceDescription?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 250, nullable: true })
  merchantName?: string | null;

  @ApiPropertyOptional({ type: Boolean })
  isPlanned?: boolean;

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  comment?: string | null;

  @ApiPropertyOptional({ enum: [true] })
  confirm?: true;
}

export class ResolveIncomeDeletionRequest {
  @ApiProperty({ enum: ['CANCEL', 'DELETE'] })
  allocationResolution!: 'CANCEL' | 'DELETE';
}

export class AllocationProposalResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  targetEnvelopeId!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  amountMinor!: string;

  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: Number, enum: [2] })
  scale!: 2;
}

export class TransactionResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ enum: ['INCOME', 'EXPENSE'] })
  transactionType!: 'INCOME' | 'EXPENSE';

  @ApiProperty({ enum: ['DRAFT', 'CONFIRMED', 'CANCELLED', 'DELETED'] })
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
  categoryId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  envelopeId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  sourceDescription!: string | null;

  @ApiProperty({ type: String, nullable: true })
  merchantName!: string | null;

  @ApiProperty({ type: Boolean })
  isPlanned!: boolean;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  confirmedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  cancelledAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  deletedAt!: string | null;

  @ApiProperty({ type: String, pattern: minorPattern })
  accountCurrentBalanceMinor!: string;

  @ApiProperty({ type: String, pattern: minorPattern, nullable: true })
  envelopeCurrentBalanceMinor!: string | null;

  @ApiProperty({ type: String, pattern: minorPattern })
  unallocatedMinor!: string;

  @ApiProperty({ type: AllocationProposalResponse, nullable: true })
  allocationProposal!: AllocationProposalResponse | null;
}

export class TransactionListResponse {
  @ApiProperty({ type: [TransactionResponse] })
  items!: TransactionResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}
