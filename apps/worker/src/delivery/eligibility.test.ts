import { describe, expect, it } from 'vitest';

import { cancelReason, type DeliveryFacts } from './eligibility.js';

const ok: DeliveryFacts = {
  user: { email: 'a@x.test', status: 'ACTIVE', emailVerifiedAt: new Date() },
  setting: { enabled: true, urgentEnabled: true, digestFrequency: 'DAILY', includeAmounts: false },
  activeMember: true,
  budgetActive: true,
  notification: { resolvedAt: null, readAt: null },
};

describe('cancelReason', () => {
  it('passes a deliverable letter', () => {
    expect(cancelReason('URGENT', ok)).toBeNull();
    expect(cancelReason('DIGEST', { ...ok, notification: null })).toBeNull();
  });

  it.each([
    ['USER_INACTIVE', { user: { ...ok.user!, status: 'DELETION_PENDING' } }, 'DIGEST'],
    ['EMAIL_NOT_VERIFIED', { user: { ...ok.user!, emailVerifiedAt: null } }, 'DIGEST'],
    ['CHANNEL_DISABLED', { setting: { ...ok.setting!, enabled: false } }, 'DIGEST'],
    ['CHANNEL_DISABLED', { setting: null }, 'URGENT'],
    ['URGENT_DISABLED', { setting: { ...ok.setting!, urgentEnabled: false } }, 'URGENT'],
    ['DIGEST_DISABLED', { setting: { ...ok.setting!, digestFrequency: 'OFF' } }, 'DIGEST'],
    ['BUDGET_INACTIVE', { budgetActive: false }, 'DIGEST'],
    ['NOT_A_MEMBER', { activeMember: false }, 'DIGEST'],
    ['NOTIFICATION_CLOSED', { notification: { resolvedAt: new Date(), readAt: null } }, 'URGENT'],
    ['NOTIFICATION_CLOSED', { notification: { resolvedAt: null, readAt: new Date() } }, 'URGENT'],
    ['NOTIFICATION_CLOSED', { notification: null }, 'URGENT'],
  ] as const)('%s', (reason, patch, kind) => {
    expect(cancelReason(kind, { ...ok, ...patch } as DeliveryFacts)).toBe(reason);
  });

  it('keeps urgent off from affecting the digest', () => {
    expect(
      cancelReason('DIGEST', { ...ok, setting: { ...ok.setting!, urgentEnabled: false } }),
    ).toBeNull();
  });
});
