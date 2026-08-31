import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';

interface ApplicationErrorBody {
  code?: unknown;
  detail?: unknown;
  message?: unknown;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    const applicationError = isApplicationErrorBody(body) ? body : {};

    const problem = {
      type: 'about:blank',
      title: titleForStatus(status),
      status,
      code:
        typeof applicationError.code === 'string' ? applicationError.code : codeForStatus(status),
      detail:
        typeof applicationError.detail === 'string'
          ? applicationError.detail
          : detailForStatus(status),
      requestId: typeof request?.id === 'string' ? request.id : randomUUID(),
    };

    reply.type('application/problem+json').status(status).send(problem);
  }
}

function isApplicationErrorBody(value: unknown): value is ApplicationErrorBody {
  return typeof value === 'object' && value !== null;
}

function titleForStatus(status: number): string {
  if (status === HttpStatus.SERVICE_UNAVAILABLE) return 'Сервис временно недоступен';
  if (status === HttpStatus.NOT_FOUND) return 'Ресурс не найден';
  if (status >= 500) return 'Внутренняя ошибка сервера';
  return 'Некорректный запрос';
}

function codeForStatus(status: number): string {
  if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
  if (status >= 500) return 'INTERNAL_ERROR';
  return 'REQUEST_ERROR';
}

function detailForStatus(status: number): string {
  if (status === HttpStatus.NOT_FOUND) return 'Запрошенный ресурс не найден.';
  if (status >= 500) return 'Не удалось обработать запрос.';
  return 'Запрос не может быть обработан.';
}
