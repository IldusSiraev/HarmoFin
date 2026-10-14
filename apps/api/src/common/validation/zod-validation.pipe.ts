import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export interface FieldError {
  field: string;
  message: string;
  code: string;
}

@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const fieldErrors: FieldError[] = [];
    for (const issue of result.error.issues) {
      if (issue.code === 'unrecognized_keys' && 'keys' in issue) {
        for (const key of issue.keys) {
          fieldErrors.push({ field: key, message: `Неизвестное поле: ${key}.`, code: issue.code });
        }
      } else {
        fieldErrors.push({
          field: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        });
      }
    }
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: 'Проверьте корректность полей запроса.',
      fieldErrors,
    });
  }
}
