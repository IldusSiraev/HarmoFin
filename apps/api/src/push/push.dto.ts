import { ApiProperty } from '@nestjs/swagger';

export class PushDeviceResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, description: 'Браузер и система, например «Chrome, Android».' })
  label!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastSuccessAt!: string | null;

  @ApiProperty({ type: Boolean, description: 'Устройство текущей сессии.' })
  current!: boolean;
}

export class PushNotificationSettingsResponse {
  @ApiProperty({ type: Boolean, description: 'VAPID настроен на сервере.' })
  available!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Публичный VAPID-ключ (base64url) для PushManager.subscribe; null без настройки.',
  })
  vapidPublicKey!: string | null;

  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({ type: Boolean, description: 'Просроченный платёж.' })
  planOverdueEnabled!: boolean;

  @ApiProperty({ type: Boolean, description: 'Напоминание календаря.' })
  calendarReminderEnabled!: boolean;

  @ApiProperty({
    type: [PushDeviceResponse],
    description: 'Устройства активных сессий; адрес push-сервиса не отдаётся.',
  })
  devices!: PushDeviceResponse[];
}

export class UpdatePushNotificationSettingsRequest {
  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({ type: Boolean })
  planOverdueEnabled!: boolean;

  @ApiProperty({ type: Boolean })
  calendarReminderEnabled!: boolean;
}

export class PushSubscriptionKeysRequest {
  @ApiProperty({ type: String, description: 'base64url, 65 байт, первый байт 0x04.' })
  p256dh!: string;

  @ApiProperty({ type: String, description: 'base64url, 16 байт.' })
  auth!: string;
}

export class CreatePushSubscriptionRequest {
  @ApiProperty({
    type: String,
    maxLength: 2048,
    description: 'https-адрес push-сервиса браузера (FCM, Mozilla, Apple, Microsoft).',
  })
  endpoint!: string;

  @ApiProperty({ type: PushSubscriptionKeysRequest })
  keys!: PushSubscriptionKeysRequest;
}
