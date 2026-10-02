import { ApiProperty } from '@nestjs/swagger';

export class LegacyCorrectionPreviewBody {
  @ApiProperty({
    type: String,
    required: false,
    example: '2000.00',
    description:
      'Новая сумма старой операции (рубли, до 2 знаков). Не сочетается с status DELETED.',
  })
  amount?: string;

  @ApiProperty({
    type: String,
    required: false,
    enum: ['CONFIRMED', 'DELETED'],
    description:
      'DELETED - логическое удаление старого факта; CONFIRMED - оставить подтверждённым.',
  })
  status?: 'CONFIRMED' | 'DELETED';
}

export class LegacyCorrectionBody extends LegacyCorrectionPreviewBody {
  @ApiProperty({
    type: String,
    example: 'a3f1c0de0000000000000000000000000000000000000000000000000000beef',
    description: 'SHA-256 из correction-preview; при изменении состояния ответ 409 PREVIEW_STALE.',
  })
  previewHash!: string;

  @ApiProperty({
    type: String,
    required: false,
    enum: ['CANCEL', 'DELETE'],
    description:
      'Обязателен, если новая сумма дохода меньше суммы подтверждённых распределений (409 ALLOCATION_RESOLUTION_REQUIRED); без такой необходимости не передаётся.',
  })
  allocationResolution?: 'CANCEL' | 'DELETE';
}

export class LegacyCorrectionAllocation {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String, example: '80000', description: 'Minor units.' })
  amountMinor!: string;

  @ApiProperty({ type: String, enum: ['CONFIRMED', 'CANCELLED', 'DELETED'] })
  status!: string;

  @ApiProperty({ type: String })
  envelopeId!: string;

  @ApiProperty({ type: String })
  accountId!: string;

  @ApiProperty({ type: String, example: '2026-09-01' })
  occurredOn!: string;
}

export class LegacyCorrectionSafe {
  @ApiProperty({ type: String, enum: ['READY', 'NEEDS_PERIOD_SETUP'] })
  state!: 'READY' | 'NEEDS_PERIOD_SETUP';

  @ApiProperty({ type: String, nullable: true, example: '400000' })
  amountMinor!: string | null;
}

export class LegacyCorrectionPreviewResponse {
  @ApiProperty({ type: String, example: '-100000', description: 'Изменение денег на счетах.' })
  cashDeltaMinor!: string;

  @ApiProperty({ type: LegacyCorrectionSafe })
  newSafe!: LegacyCorrectionSafe;

  @ApiProperty({ type: String, example: '0' })
  newFreeToAssignMinor!: string;

  @ApiProperty({ type: [LegacyCorrectionAllocation] })
  linkedAllocations!: LegacyCorrectionAllocation[];

  @ApiProperty({ type: Boolean })
  allocationResolutionRequired!: boolean;

  @ApiProperty({ type: String })
  previewHash!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Пояснение по-русски, когда правка расходится с текущими назначениями.',
  })
  explanation!: string | null;
}

export class LegacyCorrectionResolvedAllocation {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String, enum: ['CANCELLED', 'DELETED'] })
  status!: string;
}

export class LegacyCorrectionResponse {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  budgetId!: string;

  @ApiProperty({ type: String, enum: ['INCOME', 'EXPENSE'] })
  transactionType!: 'INCOME' | 'EXPENSE';

  @ApiProperty({ type: String, enum: ['CONFIRMED', 'DELETED'] })
  status!: 'CONFIRMED' | 'DELETED';

  @ApiProperty({ type: String, example: '200000' })
  amountMinor!: string;

  @ApiProperty({ type: String, example: '2026-09-01' })
  occurredOn!: string;

  @ApiProperty({ type: String })
  accountId!: string;

  @ApiProperty({ type: String, example: '-100000' })
  cashDeltaMinor!: string;

  @ApiProperty({ type: String })
  accountBalanceMinor!: string;

  @ApiProperty({ type: LegacyCorrectionSafe })
  newSafe!: LegacyCorrectionSafe;

  @ApiProperty({ type: String })
  newFreeToAssignMinor!: string;

  @ApiProperty({ type: [LegacyCorrectionResolvedAllocation] })
  resolvedAllocations!: LegacyCorrectionResolvedAllocation[];

  @ApiProperty({ type: String, nullable: true })
  explanation!: string | null;
}
