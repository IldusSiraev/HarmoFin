import { ApiProperty } from '@nestjs/swagger';

export class ObligationPayBody {
  @ApiProperty({
    type: String,
    format: 'uuid',
    maxLength: 36,
    example: '0195f3c3-aaaa-bbbb-cccc-000000000003',
  })
  accountId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    maxLength: 36,
    example: '0195f3c3-aaaa-bbbb-cccc-000000000004',
  })
  categoryId!: string;

  @ApiProperty({
    type: String,
    example: '2000.00',
    description: 'Десятичная строка, рубли, до 2 знаков.',
  })
  amount!: string;

  @ApiProperty({ type: String, example: '2026-09-30', format: 'date', maxLength: 10 })
  occurredOn!: string;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      'true: платёж частичный, обязательство остаётся открытым, пока оплата не достигнет ожидаемой суммы. false: обязательство завершается этой оплатой.',
  })
  willPayMore!: boolean;
}

export class ObligationWarningView {
  @ApiProperty({ type: String, example: 'ENVELOPE_BALANCE_INSUFFICIENT' })
  code!: string;

  @ApiProperty({ type: String, example: 'Назначение конверта меньше расхода; оплата проведена.' })
  detail!: string;
}

export class ObligationOccurrenceResponse {
  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  id!: string;

  @ApiProperty({
    type: String,
    enum: ['PENDING', 'DUE', 'COMPLETED', 'SKIPPED', 'CANCELLED'],
    example: 'DUE',
  })
  status!: string;

  @ApiProperty({
    type: String,
    example: '300000',
    description: 'Ожидаемая сумма по плану (minor, строка).',
  })
  expectedMinor!: string;

  @ApiProperty({
    type: String,
    example: '200000',
    description: 'Сумма подтверждённых оплат (minor, строка).',
  })
  paidMinor!: string;

  @ApiProperty({
    type: String,
    example: '100000',
    description: 'Остаток к оплате (minor, строка).',
  })
  unpaidMinor!: string;
}

export class ObligationTransactionResponse {
  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  id!: string;

  @ApiProperty({
    type: String,
    example: '200000',
    description: 'Сумма оплаты в минорных единицах (строка).',
  })
  amountMinor!: string;

  @ApiProperty({ type: String, example: '2026-09-30', format: 'date', maxLength: 10 })
  occurredOn!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  accountId!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  categoryId!: string;

  @ApiProperty({ type: String, format: 'uuid', maxLength: 36 })
  envelopeId!: string;

  @ApiProperty({
    type: String,
    example: '1518000',
    description: 'Остаток счёта после оплаты (minor, строка).',
  })
  accountBalanceMinor!: string;
}

export class ObligationResultResponse {
  @ApiProperty({
    type: ObligationTransactionResponse,
    nullable: true,
    description: 'Созданный расход; null для skip и close.',
  })
  transaction!: ObligationTransactionResponse | null;

  @ApiProperty({ type: ObligationOccurrenceResponse })
  occurrence!: ObligationOccurrenceResponse;

  @ApiProperty({ type: [ObligationWarningView] })
  warnings!: ObligationWarningView[];
}
