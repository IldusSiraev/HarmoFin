import { ApiProperty } from '@nestjs/swagger';

export class PlansCalendarDayResponse {
  @ApiProperty({ type: String, format: 'date', example: '2026-09-05' })
  date!: string;

  @ApiProperty({
    type: String,
    example: '4300000',
    description: 'CONFIRMED доходы дня, minor units.',
  })
  incomeMinor!: string;

  @ApiProperty({
    type: String,
    example: '700000',
    description: 'CONFIRMED расходы дня, minor units.',
  })
  expenseMinor!: string;

  @ApiProperty({
    type: String,
    enum: ['upcoming', 'overdue'],
    nullable: true,
    description:
      'Есть открытый план на этот день; overdue — открытый платёж раньше сегодняшней даты.',
  })
  dot!: 'upcoming' | 'overdue' | null;
}

export class PlansCalendarOwnerResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Алия' })
  displayName!: string | null;

  @ApiProperty({
    type: Boolean,
    description: 'False когда человек исключён из рабочего пространства или вышел из него.',
  })
  isActiveMember!: boolean;
}

export class PlansCalendarItemResponse {
  @ApiProperty({ type: String, enum: ['OBLIGATION', 'INCOME_PLAN'] })
  kind!: 'OBLIGATION' | 'INCOME_PLAN';

  @ApiProperty({ type: String, format: 'uuid' })
  occurrenceId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  planId!: string;

  @ApiProperty({ type: PlansCalendarOwnerResponse })
  owner!: PlansCalendarOwnerResponse;

  @ApiProperty({
    type: Boolean,
    description: 'Может ли текущий участник управлять планом, к которому относится событие.',
  })
  canEdit!: boolean;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, format: 'date' })
  scheduledOn!: string;

  @ApiProperty({ type: String, enum: ['PENDING', 'DUE', 'SKIPPED', 'COMPLETED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({ type: String, example: '4000000' })
  expectedMinor!: string;

  @ApiProperty({ type: String, example: '0', description: 'Для планового дохода всегда 0.' })
  paidMinor!: string;

  @ApiProperty({
    type: String,
    example: '4000000',
    description: 'Для планового дохода всегда 0.',
  })
  unpaidMinor!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  categoryId!: string | null;

  @ApiProperty({ type: Boolean, description: 'Открытый платёж раньше сегодняшней даты.' })
  overdue!: boolean;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Операция записанного планового дохода.',
  })
  transactionId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description:
      'Для COMPLETED с подтверждённой операцией: дата последней такой операции. План показывается в этот день один раз, а не в день по плану. Иначе null.',
  })
  factOn!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '4000000',
    description: 'Сумма подтверждённых операций, закрывших план, minor units; null без них.',
  })
  factMinor!: string | null;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Подтверждённые операции, закрывшие план (оплаты платежа или запись дохода). Пустой массив без них.',
  })
  factTransactionIds!: string[];
}

export class PlansCalendarTotalsResponse {
  @ApiProperty({ type: String, example: '10000000' })
  plannedIncomeMinor!: string;

  @ApiProperty({ type: String, example: '4300000' })
  plannedExpenseMinor!: string;

  @ApiProperty({
    type: String,
    example: '5700000',
    description: 'Плановые доходы минус плановые расходы месяца.',
  })
  balanceMinor!: string;

  @ApiProperty({ type: Number, example: 3 })
  activePlanCount!: number;
}

export class PlansCalendarResponse {
  @ApiProperty({ type: String, example: '2026-09' })
  month!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    description: 'Сегодняшняя дата в часовом поясе бюджета.',
  })
  today!: string;

  @ApiProperty({ type: [PlansCalendarDayResponse] })
  days!: PlansCalendarDayResponse[];

  @ApiProperty({
    type: [PlansCalendarItemResponse],
    description:
      'Планы с датой в этом месяце, а также COMPLETED-планы другого месяца, закрытые операцией в этом месяце (factOn в месяце). totals и days считают только планы с датой в месяце.',
  })
  items!: PlansCalendarItemResponse[];

  @ApiProperty({
    type: [PlansCalendarItemResponse],
    description: 'Все открытые просроченные платежи бюджета, независимо от месяца.',
  })
  overdue!: PlansCalendarItemResponse[];

  @ApiProperty({ type: Number })
  overdueCount!: number;

  @ApiProperty({ type: PlansCalendarTotalsResponse })
  totals!: PlansCalendarTotalsResponse;
}
