import { ApiProperty } from '@nestjs/swagger';

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
