import { describe, expect, it } from 'vitest';

import { landingSeo } from './landing-seo.js';

describe('landingSeo', () => {
  it('matches the copy required by the landing brief', () => {
    expect(landingSeo.title).toBe('HarmoFin — управляйте личными и семейными финансами');
    expect(landingSeo.description).toBe(
      'HarmoFin помогает управлять семейным бюджетом, распределять деньги по целям и видеть, сколько действительно можно потратить.',
    );
    expect(landingSeo.ogTitle).toBe(landingSeo.title);
    expect(landingSeo.ogDescription).toBe(landingSeo.description);
    expect(landingSeo.ogType).toBe('website');
    expect(landingSeo.ogLocale).toBe('ru_RU');
    expect(landingSeo.twitterCard).toBe('summary_large_image');
  });
});
