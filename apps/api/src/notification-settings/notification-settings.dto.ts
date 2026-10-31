import { ApiProperty } from '@nestjs/swagger';

const FREQUENCIES = ['OFF', 'DAILY', 'WEEKLY'] as const;

export class EmailNotificationSettingsResponse {
  @ApiProperty({ type: String, description: 'Адрес аккаунта, частично скрыт: a***@example.com.' })
  email!: string;

  @ApiProperty({ type: Boolean, description: 'Адрес подтверждён; без этого канал не включить.' })
  emailVerified!: boolean;

  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({ type: Boolean, description: 'Просроченный платёж и напоминание календаря.' })
  urgentEnabled!: boolean;

  @ApiProperty({
    type: String,
    enum: FREQUENCIES,
    description: 'В 08:00 по часовому поясу бюджета.',
  })
  digestFrequency!: (typeof FREQUENCIES)[number];

  @ApiProperty({ type: Boolean })
  includeAmounts!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  amountsConsentAt!: string | null;
}

export class UpdateEmailNotificationSettingsRequest {
  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({ type: Boolean })
  urgentEnabled!: boolean;

  @ApiProperty({ type: String, enum: FREQUENCIES })
  digestFrequency!: (typeof FREQUENCIES)[number];

  @ApiProperty({ type: Boolean })
  includeAmounts!: boolean;

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Обязательно true, когда includeAmounts включается впервые.',
  })
  amountsConsent?: boolean;
}

export class UnsubscribeRequest {
  @ApiProperty({
    type: String,
    description: 'Токен из ссылки «Отписаться» в письме.',
    maxLength: 256,
  })
  token!: string;
}
