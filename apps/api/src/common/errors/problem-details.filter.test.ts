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

  it('preserves safe application error fields', () => {
    const send = vi.fn();
    const reply = {
      type: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send,
    };
    const host = createHost(reply, 'request-2');
    const exception = new HttpException(
      { code: 'DATABASE_UNAVAILABLE', detail: 'База данных временно недоступна.' },
      HttpStatus.SERVICE_UNAVAILABLE,
    );

    new ProblemDetailsFilter().catch(exception, host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 503,
        code: 'DATABASE_UNAVAILABLE',
        detail: 'База данных временно недоступна.',
        requestId: 'request-2',
      }),
    );
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
