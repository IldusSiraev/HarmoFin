import nodemailer from 'nodemailer';

import type { ApiConfig } from '../config/env.js';
import type { EmailSender } from './email-sender.js';

export class SmtpEmailSender implements EmailSender {
  private readonly transporter;

  constructor(private readonly config: ApiConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.mail.smtpHost,
      port: config.mail.smtpPort,
      ...(config.mail.smtpUser
        ? { auth: { user: config.mail.smtpUser, pass: config.mail.smtpPassword } }
        : {}),
    });
  }

  async sendPasswordRecovery(input: { recipient: string; resetUrl: string }): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.mail.from,
      to: input.recipient,
      subject: 'Восстановление пароля HarmoFin',
      text: `Откройте ссылку для восстановления пароля: ${input.resetUrl}`,
    });
  }

  async sendAccountDeletionScheduled(input: {
    recipient: string;
    restoreUrl: string;
    purgeDateLabel: string;
  }): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.mail.from,
      to: input.recipient,
      subject: 'Аккаунт HarmoFin будет удалён',
      text: [
        `Вход в аккаунт закрыт. ${input.purgeDateLabel} аккаунт и все данные бюджета будут удалены безвозвратно.`,
        `Чтобы отменить удаление, откройте ссылку до этой даты: ${input.restoreUrl}`,
        'Если это были не вы — отмените удаление и сразу смените пароль.',
      ].join('\n\n'),
    });
  }
}
