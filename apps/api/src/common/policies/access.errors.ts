import { ForbiddenException } from '@nestjs/common';

export function notObjectOwner(): ForbiddenException {
  return new ForbiddenException({
    code: 'NOT_OBJECT_OWNER',
    detail: 'Изменять может только владелец.',
  });
}

export function notAccountOwner(): ForbiddenException {
  return new ForbiddenException({
    code: 'NOT_ACCOUNT_OWNER',
    detail: 'Записывать деньги можно только по своему счёту.',
  });
}

export function notIncomeAuthor(): ForbiddenException {
  return new ForbiddenException({
    code: 'NOT_INCOME_AUTHOR',
    detail: 'Распределять можно только свой доход.',
  });
}

export function notOperationAuthor(): ForbiddenException {
  return new ForbiddenException({
    code: 'NOT_OPERATION_AUTHOR',
    detail: 'Изменять операцию может только её автор.',
  });
}

export function notEventAuthor(): ForbiddenException {
  return new ForbiddenException({
    code: 'NOT_EVENT_AUTHOR',
    detail: 'Изменять событие может только его автор.',
  });
}
