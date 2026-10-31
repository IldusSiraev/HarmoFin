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
