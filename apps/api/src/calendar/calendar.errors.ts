import { UnprocessableEntityException } from '@nestjs/common';

export function participantNotMember(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'PARTICIPANT_NOT_MEMBER',
    detail: 'Участником события может быть только член семьи.',
  });
}
