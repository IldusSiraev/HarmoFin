import { ApiProperty } from '@nestjs/swagger';

export class V2BudgetSettingsRequest {
  @ApiProperty({ type: String, required: false, minLength: 1, maxLength: 120, example: 'Семья' })
  name?: string;

  @ApiProperty({
    type: Boolean,
    required: false,
    description:
      'Разрешить отрицательный остаток счёта. Не меняет правило отрицательного виртуального конверта.',
  })
  allowNegativeAccountBalance?: boolean;

  @ApiProperty({
    type: String,
    required: false,
    maxLength: 64,
    example: 'Europe/Moscow',
    description:
      'Часовой пояс IANA. Меняется только пока нет подтверждённых операций, назначений, движений, CONFIRMED целей и ревизий цикла.',
  })
  timezone?: string;
}

export class V2BudgetSettingsResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, example: 'Семья' })
  name!: string;

  @ApiProperty({ type: String, example: 'Europe/Moscow' })
  timezone!: string;

  @ApiProperty({ type: Boolean })
  allowNegativeAccountBalance!: boolean;

  @ApiProperty({ type: Number, minimum: 1, maximum: 28 })
  cycleStartDay!: number;

  @ApiProperty({ type: Number, minimum: 1, maximum: 27 })
  periodBoundaryOffset!: number;

  @ApiProperty({ type: Number, example: 2 })
  planModelVersion!: number;
}
