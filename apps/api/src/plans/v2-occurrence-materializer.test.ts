import { describe, expect, it } from 'vitest';

import { creationHorizonEnd } from './v2-occurrence-materializer.js';

describe('creationHorizonEnd', () => {
  it('берёт горизонт worker (сегодня + 60), если конец следующего периода раньше', () => {
    expect(creationHorizonEnd('2026-10-04', '2026-10-24')).toBe('2026-12-03');
  });

  it('берёт конец следующего периода, если он позже сегодня + 60', () => {
    expect(creationHorizonEnd('2026-10-04', '2026-12-20')).toBe('2026-12-20');
  });

  it('при равенстве возвращает ту же дату', () => {
    expect(creationHorizonEnd('2026-10-04', '2026-12-03')).toBe('2026-12-03');
  });
});
