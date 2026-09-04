import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export function resourceNotFound(): NotFoundException {
  return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', detail: 'Ресурс не найден.' });
}

export function forbidden(): ForbiddenException {
  return new ForbiddenException({ code: 'FORBIDDEN', detail: 'Недостаточно прав для действия.' });
}

export function duplicateName(): ConflictException {
  return new ConflictException({
    code: 'REFERENCE_NAME_CONFLICT',
    detail: 'Справочник с таким названием уже существует.',
  });
}

export function invalidReference(): BadRequestException {
  return new BadRequestException({
    code: 'REFERENCE_INVALID',
    detail: 'Недопустимая ссылка на справочник.',
  });
}
