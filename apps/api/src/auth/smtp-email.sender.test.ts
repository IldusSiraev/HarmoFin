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
});
