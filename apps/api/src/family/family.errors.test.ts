import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { MEMBER_LIMIT, PENDING_INVITATION_LIMIT } from './invitation.domain.js';
import {
  alreadyMember,
  cannotChangeCreator,
  displayNameRequired,
  invitationAlreadyAccepted,
  invitationAlreadyPending,
  invitationEmailMismatch,
  invitationExpired,
  invitationLimitReached,
  invitationNotFound,
  invitationRevoked,
  memberLimitReached,
} from './family.errors.js';

describe('family errors', () => {
  it.each([
    {
      name: 'invitationNotFound',
      factory: invitationNotFound,
      expectedClass: NotFoundException,
      expectedStatus: 404,
      expectedCode: 'INVITATION_NOT_FOUND',
    },
    {
      name: 'invitationExpired',
      factory: invitationExpired,
      expectedClass: GoneException,
      expectedStatus: 410,
      expectedCode: 'INVITATION_EXPIRED',
    },
    {
      name: 'invitationRevoked',
      factory: invitationRevoked,
      expectedClass: GoneException,
      expectedStatus: 410,
      expectedCode: 'INVITATION_REVOKED',
    },
    {
      name: 'invitationAlreadyAccepted',
      factory: invitationAlreadyAccepted,
      expectedClass: ConflictException,
      expectedStatus: 409,
      expectedCode: 'INVITATION_ALREADY_ACCEPTED',
    },
    {
      name: 'invitationEmailMismatch',
      factory: invitationEmailMismatch,
      expectedClass: ForbiddenException,
      expectedStatus: 403,
      expectedCode: 'INVITATION_EMAIL_MISMATCH',
    },
    {
      name: 'invitationAlreadyPending',
      factory: invitationAlreadyPending,
      expectedClass: ConflictException,
      expectedStatus: 409,
      expectedCode: 'INVITATION_ALREADY_PENDING',
    },
    {
      name: 'alreadyMember',
      factory: alreadyMember,
      expectedClass: ConflictException,
      expectedStatus: 409,
      expectedCode: 'ALREADY_MEMBER',
    },
    {
      name: 'memberLimitReached',
      factory: memberLimitReached,
      expectedClass: ConflictException,
      expectedStatus: 409,
      expectedCode: 'MEMBER_LIMIT_REACHED',
      expectedDetailContains: String(MEMBER_LIMIT),
    },
    {
      name: 'invitationLimitReached',
      factory: invitationLimitReached,
      expectedClass: ConflictException,
      expectedStatus: 409,
      expectedCode: 'INVITATION_LIMIT_REACHED',
      expectedDetailContains: String(PENDING_INVITATION_LIMIT),
    },
    {
      name: 'cannotChangeCreator',
      factory: cannotChangeCreator,
      expectedClass: ConflictException,
      expectedStatus: 409,
      expectedCode: 'CANNOT_CHANGE_CREATOR',
    },
    {
      name: 'displayNameRequired',
      factory: displayNameRequired,
      expectedClass: UnprocessableEntityException,
      expectedStatus: 422,
      expectedCode: 'DISPLAY_NAME_REQUIRED',
    },
  ])(
    '$name',
    ({
      factory,
      expectedClass,
      expectedStatus,
      expectedCode,
      expectedDetailContains,
    }) => {
      const exception = factory();

      // Check instance type
      expect(exception).toBeInstanceOf(expectedClass);

      // Check status code
      expect(exception.getStatus()).toBe(expectedStatus);

      // Check response contains code and detail
      const response = exception.getResponse();
      expect(response).toEqual(
        expect.objectContaining({
          code: expectedCode,
          detail: expect.any(String),
        }),
      );

      // Check detail is non-empty
      const { detail } = response as Record<string, unknown>;
      expect(typeof detail).toBe('string');
      expect((detail as string).length).toBeGreaterThan(0);

      // If a specific detail value is expected, check it's present
      if (expectedDetailContains) {
        expect((detail as string)).toContain(expectedDetailContains);
      }
    },
  );
});
