import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { MEMBER_LIMIT, PENDING_INVITATION_LIMIT } from './invitation.domain.js';

export const invitationNotFound = () =>
  new NotFoundException({
    code: 'INVITATION_NOT_FOUND',
    detail: 'Приглашение не найдено.',
  });
export const invitationExpired = () =>
  new GoneException({
    code: 'INVITATION_EXPIRED',
    detail: 'Срок приглашения истёк. Попросите отправить новое.',
  });
export const invitationRevoked = () =>
  new GoneException({ code: 'INVITATION_REVOKED', detail: 'Приглашение отозвано.' });
export const invitationAlreadyAccepted = () =>
  new ConflictException({
    code: 'INVITATION_ALREADY_ACCEPTED',
    detail: 'Приглашение уже принято.',
  });
export const invitationEmailMismatch = () =>
  new ForbiddenException({
    code: 'INVITATION_EMAIL_MISMATCH',
    detail: 'Приглашение отправлено на другой email.',
  });
export const invitationAlreadyPending = () =>
  new ConflictException({
    code: 'INVITATION_ALREADY_PENDING',
    detail: 'На этот email уже отправлено приглашение. Отправьте его повторно.',
  });
export const alreadyMember = () =>
  new ConflictException({ code: 'ALREADY_MEMBER', detail: 'Этот человек уже в семье.' });
export const memberLimitReached = () =>
  new ConflictException({
    code: 'MEMBER_LIMIT_REACHED',
    detail: `В семье может быть не больше ${MEMBER_LIMIT} участников.`,
  });
export const invitationLimitReached = () =>
  new ConflictException({
    code: 'INVITATION_LIMIT_REACHED',
    detail: `Активных приглашений может быть не больше ${PENDING_INVITATION_LIMIT}.`,
  });
export const cannotChangeCreator = () =>
  new ConflictException({
    code: 'CANNOT_CHANGE_CREATOR',
    detail: 'Роль создателя семьи нельзя изменить или удалить.',
  });
export const displayNameRequired = () =>
  new UnprocessableEntityException({
    code: 'DISPLAY_NAME_REQUIRED',
    detail: 'Укажите ваше имя — его увидят остальные участники.',
  });
