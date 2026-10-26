import { ApiProperty } from '@nestjs/swagger';

import { PersonRefResponse } from '../common/people/person-ref.dto.js';

export class DirectTransferResponse {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  id!: string;

  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000002' })
  budgetId!: string;

  @ApiProperty({ type: String, example: 'CONFIRMED' })
  status!: 'CONFIRMED' | 'DRAFT' | 'CANCELLED' | 'DELETED';

  @ApiProperty({ type: String, enum: ['ACCOUNT_ONLY'], example: 'ACCOUNT_ONLY' })
  mode!: 'ACCOUNT_ONLY';

  @ApiProperty({ type: String, example: '5000000' })
  totalMinor!: string;

  @ApiProperty({ type: String, example: 'Перевод на отпуск', required: false })
  comment!: string | null;

  @ApiProperty({ type: String, example: '2026-09-30' })
  occurredOn!: string;

  @ApiProperty({
    type: String,
    description: 'Только для ACCOUNT_ONLY',
    nullable: true,
    example: '0195f3c3-aaaa-bbbb-cccc-000000000003',
  })
  sourceAccountId!: string | null;

  @ApiProperty({
    type: String,
    description: 'Только для ACCOUNT_ONLY',
    nullable: true,
    example: '0195f3c3-aaaa-bbbb-cccc-000000000004',
  })
  destinationAccountId!: string | null;

  @ApiProperty({ type: PersonRefResponse, required: false })
  createdBy?: PersonRefResponse;
}

export class CreateDirectTransferInput {
  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000003' })
  sourceAccountId!: string;

  @ApiProperty({ type: String, example: '0195f3c3-aaaa-bbbb-cccc-000000000004' })
  destinationAccountId!: string;

  @ApiProperty({ type: String, example: '50000' })
  amount!: string;

  @ApiProperty({ type: String, example: '2026-09-30' })
  occurredOn!: string;

  @ApiProperty({ type: String, required: false, example: 'Перевод на отпуск' })
  comment?: string;
}

export class DirectTransferListResponse {
  @ApiProperty({ type: [DirectTransferResponse] })
  items!: DirectTransferResponse[];

  @ApiProperty({ type: String, nullable: true, example: null })
  nextCursor!: string | null;
}

export class UpdateDirectTransferInput {
  @ApiProperty({ type: String, required: false, example: '0195f3c3-aaaa-bbbb-cccc-000000000003' })
  sourceAccountId?: string;

  @ApiProperty({ type: String, required: false, example: '0195f3c3-aaaa-bbbb-cccc-000000000004' })
  destinationAccountId?: string;

  @ApiProperty({ type: String, required: false, example: '1500.00' })
  amount?: string;

  @ApiProperty({ type: String, required: false, example: '2026-10-20' })
  occurredOn?: string;

  @ApiProperty({ type: String, required: false, nullable: true, maxLength: 500, example: 'Отпуск' })
  comment?: string | null;
}

export class TransferJournalItemResponse {
  @ApiProperty({ type: String, enum: ['TRANSFER'], example: 'TRANSFER' })
  kind!: 'TRANSFER';

  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ type: String, enum: ['CONFIRMED', 'DELETED'] })
  status!: 'CONFIRMED' | 'DELETED';

  @ApiProperty({ type: String, example: '150000' })
  amountMinor!: string;

  @ApiProperty({ type: String, example: 'RUB' })
  currency!: string;

  @ApiProperty({ type: String, example: '2026-10-20' })
  occurredOn!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  sourceAccountId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  destinationAccountId!: string;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: string | null;
}
