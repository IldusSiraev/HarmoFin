import { ApiProperty } from '@nestjs/swagger';

import { PersonRefResponse } from '../common/people/person-ref.dto.js';
import { FEED_KINDS } from './feed-kinds.js';

const LINK_TYPES = [
  'TRANSACTION',
  'TRANSFER',
  'ENVELOPE',
  'PLAN_OCCURRENCE',
  'PLAN',
  'CALENDAR_EVENT',
] as const;

export class ActivityLinkResponse {
  @ApiProperty({ type: String, enum: LINK_TYPES })
  type!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: 'Только для событий календаря: дата начала в часовом поясе бюджета.',
  })
  date!: string | null;
}

export class ActivityItemResponse {
  @ApiProperty({ type: String, format: 'uuid', description: 'Идентификатор записи аудита.' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({ type: String, enum: FEED_KINDS })
  kind!: string;

  @ApiProperty({ type: Boolean, description: 'Событие позже отметки «просмотрено».' })
  isNew!: boolean;

  @ApiProperty({ type: PersonRefResponse })
  actor!: PersonRefResponse;

  @ApiProperty({
    type: String,
    pattern: '^\\d+$',
    nullable: true,
    description: 'Сумма в minor units из записи аудита; у оплаты платежа и событий семьи — null.',
  })
  amountMinor!: string | null;

  @ApiProperty({ type: String, example: 'RUB' })
  currency!: string;

  @ApiProperty({ type: String, enum: ['INCOME', 'EXPENSE'], nullable: true })
  transactionType!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Категория, конверт, план или событие; для отсутствующего объекта — нейтральная метка.',
  })
  title!: string | null;

  @ApiProperty({ type: [String], description: 'Счета и конверты по порядку показа.' })
  details!: string[];

  @ApiProperty({
    type: PersonRefResponse,
    nullable: true,
    description: 'Только для MEMBER_REMOVED: исключённый участник.',
  })
  target!: PersonRefResponse | null;

  @ApiProperty({
    type: ActivityLinkResponse,
    nullable: true,
    description: 'null, если объект удалён или открыть его нельзя.',
  })
  link!: ActivityLinkResponse | null;
}

export class ActivityFeedResponse {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  seenAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Граница isNew: seenAt, а без отметки — время сервера минус 7 дней.',
  })
  newSince!: string;

  @ApiProperty({
    type: Number,
    minimum: 0,
    description:
      'Новые события с отметки (без отметки — за 7 дней); фильтр actorId не учитывается.',
  })
  unseenCount!: number;

  @ApiProperty({
    type: [PersonRefResponse],
    description: 'Другие участники семьи, включая бывших.',
  })
  people!: PersonRefResponse[];

  @ApiProperty({ type: [ActivityItemResponse] })
  items!: ActivityItemResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class ActivityFeedSeenResponse {
  @ApiProperty({ type: String, format: 'date-time' })
  seenAt!: string;
}
