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
  fieldErrors?: unknown;
  allocationIds?: unknown;
  allocationCount?: unknown;
}

interface FieldError {
  field: string;
  message: string;
  code: string;
}

export interface ErrorReporter {
  report(error: unknown, context?: unknown): Promise<boolean>;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly errorReporter?: ErrorReporter) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    const applicationError = isApplicationErrorBody(body) ? body : {};
    const requestId = typeof request?.id === 'string' ? request.id : randomUUID();

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
      requestId,
      ...(isFieldErrors(applicationError.fieldErrors)
        ? { fieldErrors: applicationError.fieldErrors }
        : {}),
      ...(isStringArray(applicationError.allocationIds)
        ? { allocationIds: applicationError.allocationIds }
        : {}),
      ...(isNonNegativeInteger(applicationError.allocationCount)
        ? { allocationCount: applicationError.allocationCount }
        : {}),
    };

    if (status >= 500) {
      void this.errorReporter?.report(exception, { requestId, route: request?.url, status });
    }

    reply.type('application/problem+json').status(status).send(problem);
  }
}

function isApplicationErrorBody(value: unknown): value is ApplicationErrorBody {
  return typeof value === 'object' && value !== null;
}

function isFieldErrors(value: unknown): value is FieldError[] {
  return (
    Array.isArray(value) &&
    value.every(
      (fieldError) =>
        typeof fieldError === 'object' &&
        fieldError !== null &&
        typeof fieldError.field === 'string' &&
        typeof fieldError.message === 'string' &&
        typeof fieldError.code === 'string',
    )
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
