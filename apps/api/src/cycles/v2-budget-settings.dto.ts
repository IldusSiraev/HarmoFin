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
    example: 'Asia/Yekaterinburg',
    description:
      'Часовой пояс IANA. Меняется в любое время; сохранённые даты не меняются. 409 TIMEZONE_CHANGE_WOULD_FUTURE_DATE_FACTS, если после смены какая-то дата факта окажется позже «сегодня» нового пояса.',
  })
  timezone?: string;

  @ApiProperty({
    type: String,
    enum: ['KEEP_WALL_CLOCK', 'KEEP_INSTANT'],
    required: false,
    description:
      'Только вместе с timezone. Как сдвинуть события календаря со временем: сохранить настенное время (KEEP_WALL_CLOCK) или момент (KEEP_INSTANT). Обязательно, если такие события есть, иначе 422 TIMED_EVENTS_MODE_REQUIRED.',
  })
  timedEvents?: 'KEEP_WALL_CLOCK' | 'KEEP_INSTANT';
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
