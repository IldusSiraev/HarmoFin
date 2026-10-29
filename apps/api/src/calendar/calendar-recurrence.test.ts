import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  expandOccurrences,
  isoWeekday,
  type Occurrence,
  type RecurringEvent,
} from './calendar-recurrence.js';

type Case = {
  name: string;
  timezone: string;
  event: RecurringEvent;
  window: { from: string; to: string };
  expected: Occurrence[];
};

const dirname = fileURLToPath(new URL('.', import.meta.url));

const fixture = JSON.parse(
  readFileSync(resolve(dirname, '../../../../fixtures/calendar-recurrence/cases.json'), 'utf8'),
) as { cases: Case[] };

describe('expandOccurrences (shared fixture)', () => {
  it.each(fixture.cases.map((item) => [item.name, item] as const))('%s', (_name, item) => {
    expect(expandOccurrences(item.event, item.window, item.timezone)).toEqual(item.expected);
  });
});

describe('isoWeekday', () => {
  it('numbers Monday 1 and Sunday 7', () => {
    expect(isoWeekday('2026-10-05')).toBe(1);
    expect(isoWeekday('2026-10-11')).toBe(7);
  });
});
