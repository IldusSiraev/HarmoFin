import { ApiProperty } from '@nestjs/swagger';

export class CreateTelegramLinkRequest {
  @ApiProperty({
    type: Boolean,
    description:
      'Согласие на отправку уведомлений через серверы Telegram (сторонний сервис). Должно быть true.',
  })
  consent!: boolean;
}

export class TelegramLinkResponse {
  @ApiProperty({
    type: String,
    description: 'Ссылка https://t.me/<бот>?start=<код>. Код одноразовый.',
  })
  url!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Через 15 минут после выдачи.' })
  expiresAt!: string;
}

const FREQUENCIES = ['OFF', 'DAILY', 'WEEKLY'] as const;

export class TelegramNotificationSettingsResponse {
  @ApiProperty({ type: Boolean, description: 'Бот настроен на сервере.' })
  available!: boolean;

  @ApiProperty({ type: Boolean, description: 'Личный чат привязан; без этого канал не включить.' })
  linked!: boolean;

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

  @ApiProperty({ type: Boolean, description: 'Срочное сообщение о просроченном платеже.' })
  planOverdueEnabled!: boolean;

  @ApiProperty({ type: Boolean, description: 'Срочное сообщение с напоминанием календаря.' })
  calendarReminderEnabled!: boolean;

  @ApiProperty({
    type: Boolean,
    description: 'Команды бота включены для привязанного чата; без привязки всегда false.',
  })
  commandsEnabled!: boolean;
}

export class UpdateTelegramNotificationSettingsRequest {
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

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Если не передано, значение не меняется; по умолчанию true.',
  })
  planOverdueEnabled?: boolean;

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Если не передано, значение не меняется; по умолчанию true.',
  })
  calendarReminderEnabled?: boolean;
}

export class UpdateTelegramCommandsRequest {
  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({
    type: Boolean,
    required: false,
    description:
      'Обязательно true при включении: ответы бота с суммами и названиями остаются в истории чата, из чата можно проводить операции.',
  })
  consent?: boolean;
}
