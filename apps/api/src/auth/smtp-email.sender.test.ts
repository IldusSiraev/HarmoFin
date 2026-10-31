import { describe, expect, it, vi } from 'vitest';

const sendMail = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

import { SmtpEmailSender } from './smtp-email.sender.js';

const config = {
  mail: { smtpHost: '127.0.0.1', smtpPort: 1025, from: 'no-reply@harmofin.test' },
} as never;

describe('SmtpEmailSender', () => {
  it('sends the deletion notice with the purge date and restore link', async () => {
    await new SmtpEmailSender(config).sendAccountDeletionScheduled({
      recipient: 'owner@harmofin.test',
      restoreUrl: 'http://localhost:3000/restore-account?token=abc',
      purgeDateLabel: '17.11.2026',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'no-reply@harmofin.test',
        to: 'owner@harmofin.test',
        subject: 'Аккаунт HarmoFin будет удалён',
      }),
    );
    const text = (sendMail.mock.calls[0]![0] as { text: string }).text;
    expect(text).toContain('17.11.2026');
    expect(text).toContain('http://localhost:3000/restore-account?token=abc');
    expect(text).toContain('Если это были не вы');
  });

  it('sends the family invitation with inviter, workspace, role and link', async () => {
    await new SmtpEmailSender(config).sendFamilyInvitation({
      recipient: 'alia@harmofin.test',
      inviteUrl: 'http://localhost:3000/invite#token=abc',
      inviterName: 'Иван',
      workspaceName: 'Семья Ивановых',
      roleLabel: 'Участник',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'no-reply@harmofin.test',
        to: 'alia@harmofin.test',
        subject: 'Иван приглашает вас в HarmoFin',
      }),
    );
    const text = (sendMail.mock.calls.at(-1)![0] as { text: string }).text;
    expect(text).toContain('Семья Ивановых');
    expect(text).toContain('Участник');
    expect(text).toContain('http://localhost:3000/invite#token=abc');
  });

  it('sends the email verification letter with the verify link', async () => {
    await new SmtpEmailSender(config).sendEmailVerification({
      recipient: 'anna@harmofin.test',
      verifyUrl: 'http://localhost:3000/verify-email?token=abc',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'no-reply@harmofin.test',
        to: 'anna@harmofin.test',
        subject: 'Подтвердите почту в HarmoFin',
      }),
    );
    const text = (sendMail.mock.calls.at(-1)![0] as { text: string }).text;
    expect(text).toContain('http://localhost:3000/verify-email?token=abc');
  });
});
