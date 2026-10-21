import { BadRequestException } from '@nestjs/common';

import type { FeedPosition } from './journal.merge.js';

type Encoded = FeedPosition & { v: 1 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function encodeFeedCursor(position: FeedPosition): string {
  const value: Encoded = { v: 1, ...position };
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeFeedCursor(value: string): FeedPosition {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Encoded>;
    if (
      parsed.v !== 1 ||
      typeof parsed.occurredOn !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(parsed.occurredOn) ||
      typeof parsed.createdAt !== 'string' ||
      !CREATED_AT.test(parsed.createdAt) ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      typeof parsed.id !== 'string' ||
      !UUID.test(parsed.id)
    ) {
      throw new Error('invalid');
    }
    return {
      occurredOn: parsed.occurredOn,
      createdAt: parsed.createdAt,
      id: parsed.id.toLowerCase(),
    };
  } catch {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      detail: 'Некорректный курсор журнала.',
    });
  }
}
