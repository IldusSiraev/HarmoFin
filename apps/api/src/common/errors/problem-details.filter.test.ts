import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ProblemDetailsFilter } from './problem-details.filter.js';

describe('ProblemDetailsFilter', () => {
  it('hides unknown exception details', () => {
    const send = vi.fn();
    const reply = {
      type: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const host = createHost(reply, 'request-1');

    new ProblemDetailsFilter().catch(new Error('password=secret'), host);

    expect(send).toHaveBeenCalledWith({
      type: 'about:blank',
      title: 'Внутренняя ошибка сервера',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'Не удалось обработать запрос.',
      requestId: 'request-1',
    });
  });

  it('preserves safe field errors from validation failures', () => {
    const send = vi.fn();
    const reply = {
      type: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const host = createHost(reply, 'request-3');
    const exception = new HttpException(
      {
        code: 'VALIDATION_FAILED',
        detail: 'Проверьте корректность полей запроса.',
        fieldErrors: [{ field: 'email', message: 'Invalid email address', code: 'invalid_format' }],
        password: 'must-not-leak',
      },
      HttpStatus.BAD_REQUEST,
    );

    new ProblemDetailsFilter().catch(exception, host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        fieldErrors: [{ field: 'email', message: 'Invalid email address', code: 'invalid_format' }],
      }),
    );
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('password');
  });

  it('preserves safe linked allocation consequences', () => {
    const send = vi.fn();
    const reply = {
      type: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const host = createHost(reply, 'request-4');
    const exception = new HttpException(
      {
        code: 'INCOME_HAS_CONFIRMED_ALLOCATIONS',
        detail: 'Подтверждённый доход имеет связанные распределения.',
        allocationIds: ['allocation-1'],
        allocationCount: 1,
        comment: 'must-not-leak',
      },
      HttpStatus.CONFLICT,
    );

    new ProblemDetailsFilter().catch(exception, host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ allocationIds: ['allocation-1'], allocationCount: 1 }),
    );
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('comment');
  });
});

function createHost(reply: object, requestId: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ id: requestId }),
      getResponse: () => reply,
    }),
  } as never;
}
