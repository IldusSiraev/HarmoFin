import { ApiExtraModels, ApiProperty } from '@nestjs/swagger';

class CycleRangeResponse {
  @ApiProperty({ type: String, format: 'date' })
  start!: string;

  @ApiProperty({ type: String, format: 'date' })
  end!: string;
}

class PeriodRangeResponse extends CycleRangeResponse {
  @ApiProperty({ enum: ['FIRST', 'SECOND'] })
  id!: 'FIRST' | 'SECOND';
}

class BalanceResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  balanceMinor!: string;
}

class WarningResponse {
  @ApiProperty({ enum: ['ACCOUNT', 'ENVELOPE'] })
  subject!: 'ACCOUNT' | 'ENVELOPE';

  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  balanceMinor!: string;
}

class PeriodLimitAvailableResponse {
  @ApiProperty({ enum: ['available'] })
  state!: 'available';

  @ApiProperty({ type: String, format: 'uuid' })
  envelopeId!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  limitMinor!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  spentMinor!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  remainingMinor!: string;

  @ApiProperty({ type: Number, minimum: 0 })
  daysUntilBoundary!: number;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  averageRemainingDailyLimitMinor!: string;
}

class PeriodLimitUnavailableResponse {
  @ApiProperty({ enum: ['unavailable'] })
  state!: 'unavailable';
}

@ApiExtraModels(PeriodLimitAvailableResponse, PeriodLimitUnavailableResponse)
export class DashboardSummaryResponse {
  @ApiProperty({ type: CycleRangeResponse })
  cycle!: CycleRangeResponse;

  @ApiProperty({ type: PeriodRangeResponse })
  period!: PeriodRangeResponse;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  totalAccountMoneyMinor!: string;

  @ApiProperty({ type: [BalanceResponse] })
  accounts!: BalanceResponse[];

  @ApiProperty({ type: [BalanceResponse] })
  envelopes!: BalanceResponse[];

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  unallocatedIncomeMinor!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    oneOf: [
      { $ref: '#/components/schemas/PeriodLimitAvailableResponse' },
      { $ref: '#/components/schemas/PeriodLimitUnavailableResponse' },
    ],
  })
  periodLimit!: PeriodLimitAvailableResponse | PeriodLimitUnavailableResponse;

  @ApiProperty({ type: [WarningResponse] })
  warnings!: WarningResponse[];
}
