import { describe, expect, it, vi } from 'vitest';

import { EmailVerificationApplicationService } from './email-verification.application.service.js';
import { TokenService } from './token.service.js';

const tokens = new TokenService('test-only-secret-with-at-least-32-bytes');
const config = { mail: { webBaseUrl: 'https://app.example.test' } };

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    emailVerificationToken: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn(),
    },
    user: { update: vi.fn().mockResolvedValue({}) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

function makeService(user: unknown, tx = makeTx()) {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(user) },
    $transaction: vi.fn((callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  };
  const sender = { sendEmailVerification: vi.fn().mockResolvedValue(undefined) };
  const service = new EmailVerificationApplicationService(
    prisma as never,
    tokens,
    sender as never,
    config as never,
  );
  return { service, prisma, sender, tx };
}

describe('EmailVerificationApplicationService.request', () => {
  it('stores only the token digest and mails a link with the raw token', async () => {
    const { service, sender, tx } = makeService({
      email: 'anna@example.test',
      status: 'ACTIVE',
      emailVerifiedAt: null,
    });

    await service.request('user-1', {});

    const created = tx.emailVerificationToken.create.mock.calls[0]![0].data;
    const link = new URL(sender.sendEmailVerification.mock.calls[0]![0].verifyUrl);
    expect(link.origin + link.pathname).toBe('https://app.example.test/verify-email');
    const raw = link.searchParams.get('token')!;
    expect(created.tokenHash).toBe(tokens.digest(raw));
    expect(created.tokenHash).not.toContain(raw);
    expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(tx.emailVerificationToken.updateMany).toHaveBeenCalled();
    expect(tx.auditEvent.create.mock.calls[0]![0].data).toMatchObject({
      action: 'EMAIL_VERIFICATION_REQUESTED',
      entityType: 'auth',
    });
    expect(JSON.stringify(tx.auditEvent.create.mock.calls)).not.toContain('anna@example.test');
  });

  it('does nothing for an already verified address', async () => {
    const { service, sender, prisma } = makeService({
      email: 'anna@example.test',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    });

    await service.request('user-1', {});

    expect(sender.sendEmailVerification).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('EmailVerificationApplicationService.confirm', () => {
  it('consumes the token and marks the address verified', async () => {
    const tx = makeTx();
    tx.emailVerificationToken.findFirst.mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      user: { status: 'ACTIVE' },
    });
    const { service } = makeService(null, tx);

    await service.confirm('raw-token', {});

    expect(tx.emailVerificationToken.findFirst.mock.calls[0]![0].where.tokenHash).toBe(
      tokens.digest('raw-token'),
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerifiedAt: expect.any(Date) },
    });
    expect(tx.auditEvent.create.mock.calls[0]![0].data.action).toBe('EMAIL_VERIFIED');
  });

  it('rejects an unknown, used or expired token with 422', async () => {
    const tx = makeTx();
    tx.emailVerificationToken.findFirst.mockResolvedValue(null);
    const { service } = makeService(null, tx);

    await expect(service.confirm('bad', {})).rejects.toMatchObject({
      status: 422,
      response: { code: 'EMAIL_VERIFICATION_TOKEN_INVALID' },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
