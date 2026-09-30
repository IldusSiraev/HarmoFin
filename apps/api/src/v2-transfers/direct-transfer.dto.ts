import { ApiProperty } from '@nestjs/swagger';

export class DirectTransferPartResponse {
  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  id!: string;

  @ApiProperty({ example: '10000' })
  amountMinor!: string;

  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000002' })
  sourceEnvelopeId!: string;

  @ApiProperty({ nullable: true })
  destinationEnvelopeId!: string | null;
}

export class DirectTransferResponse {
  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000001' })
  id!: string;

  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000002' })
  budgetId!: string;

  @ApiProperty({ example: 'CONFIRMED' })
  status!: 'CONFIRMED' | 'DRAFT' | 'CANCELLED' | 'DELETED';

  @ApiProperty({ enum: ['LEGACY_PARTS', 'ACCOUNT_ONLY'], example: 'ACCOUNT_ONLY' })
  mode!: 'LEGACY_PARTS' | 'ACCOUNT_ONLY';

  @ApiProperty({ example: '5000000' })
  totalMinor!: string;

  @ApiProperty({ example: 'Перевод на отпуск', required: false })
  comment!: string | null;

  @ApiProperty({ example: '2026-09-30' })
  occurredOn!: string;

  @ApiProperty({
    description: 'Только для ACCOUNT_ONLY',
    nullable: true,
    example: '0195f3c3-aaaa-bbbb-cccc-000000000003',
  })
  sourceAccountId!: string | null;

  @ApiProperty({
    description: 'Только для ACCOUNT_ONLY',
    nullable: true,
    example: '0195f3c3-aaaa-bbbb-cccc-000000000004',
  })
  destinationAccountId!: string | null;

  @ApiProperty({
    description: 'Для LEGACY_PARTS — части перевода; отсутствует для прямых переводов',
    type: [DirectTransferPartResponse],
    nullable: true,
  })
  parts!: DirectTransferPartResponse[] | undefined;
}

export class CreateDirectTransferInput {
  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000003' })
  sourceAccountId!: string;

  @ApiProperty({ example: '0195f3c3-aaaa-bbbb-cccc-000000000004' })
  destinationAccountId!: string;

  @ApiProperty({ example: '50000' })
  amount!: string;

  @ApiProperty({ example: '2026-09-30' })
  occurredOn!: string;

  @ApiProperty({ required: false, example: 'Перевод на отпуск' })
  comment?: string;
}

export class DirectTransferListResponse {
  @ApiProperty({ type: [DirectTransferResponse] })
  items!: DirectTransferResponse[];

  @ApiProperty({ nullable: true, example: null })
  nextCursor!: string | null;
}
