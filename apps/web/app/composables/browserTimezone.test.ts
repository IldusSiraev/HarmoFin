import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserTimezone } from './browserTimezone.js';

function mockIntl(zone: string | undefined, supported: string[] | null) {
  vi.stubGlobal('Intl', {
    ...Intl,
    DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: zone }) }),
    supportedValuesOf: () => supported,
  });
}

describe('browserTimezone', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the browser zone when it is supported', () => {
    mockIntl('Asia/Yekaterinburg', ['Asia/Yekaterinburg', 'Europe/Moscow']);
    expect(browserTimezone()).toBe('Asia/Yekaterinburg');
  });

  it('returns null for an unsupported zone', () => {
    mockIntl('Mars/Olympus', ['Europe/Moscow']);
    expect(browserTimezone()).toBeNull();
  });

  it('returns null when the zone is empty', () => {
    mockIntl(undefined, ['Europe/Moscow']);
    expect(browserTimezone()).toBeNull();
  });
});
