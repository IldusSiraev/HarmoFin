import { ApiProperty } from '@nestjs/swagger';

import { legacyAssignmentSourceKinds } from './legacy-assignment-history.schemas.js';

export class LegacyAssignmentHistoryItemResponse {
  @ApiProperty({
    type: String,
    enum: legacyAssignmentSourceKinds,
    description:
      'Источник строки: старое распределение дохода, перераспределение или старт конверта.',
  })
  sourceKind!: 'LEGACY_ALLOCATION' | 'LEGACY_ENVELOPE_START' | 'LEGACY_REALLOCATION';

  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Для старта конверта это id конверта.',
  })
  id!: string;

  @ApiProperty({ type: String, format: 'date' })
  occurredOn!: string;

  @ApiProperty({
    type: String,
    pattern: '^-?\\d+$',
    description: 'Сумма в minor units. Историческая: не входит ни в какой остаток или funded v2.',
  })
  amountMinor!: string;

  @ApiProperty({ type: String, enum: ['CONFIRMED', 'CANCELLED', 'DELETED'] })
  status!: 'CONFIRMED' | 'CANCELLED' | 'DELETED';

  @ApiProperty({ type: Boolean, description: 'Запись логически удалена.' })
  isDeleted!: boolean;

  @ApiProperty({ type: Boolean, description: 'Связанный конверт (любой из двух) архивный.' })
  isEnvelopeArchived!: boolean;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  envelopeId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  sourceEnvelopeId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  destinationEnvelopeId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  incomeTransactionId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  categoryId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  accountId!: string | null;
}

export class LegacyAssignmentHistoryResponse {
  @ApiProperty({ type: [LegacyAssignmentHistoryItemResponse] })
  items!: LegacyAssignmentHistoryItemResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Непрозрачный курсор следующей страницы.',
  })
  nextCursor!: string | null;

  @ApiProperty({ type: Boolean })
  hasMore!: boolean;
}
