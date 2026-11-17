import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8');
const luminance = (hex: string) => {
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
};

describe('brand button contrast', () => {
  it.each(['light', 'dark'])(
    'keeps white button labels readable in every enabled state (%s)',
    (theme) => {
      const root = css.match(/:root\s*\{([\s\S]*?)\}/)![1]!;
      const dark = css.match(/\[data-theme='dark'\]\s*\{([\s\S]*?)\}/)![1]!;
      const declarations = [
        ...(root + (theme === 'dark' ? dark : '')).matchAll(/(--hf-color-[\w-]+):\s*([^;]+);/g),
      ];
      const values = new Map(declarations.map((match) => [match[1]!, match[2]!.trim()]));
      const resolve = (name: string): string => {
        const raw = values.get(name)!;
        return raw.startsWith('var(') ? resolve(raw.slice(4, -1)) : raw.slice(1);
      };
      for (const token of [
        '--hf-color-action-brand',
        '--hf-color-action-brand-hover',
        '--hf-color-action-brand-active',
      ]) {
        const a = luminance(resolve('--hf-color-white'));
        const b = luminance(resolve(token));
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), token).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    },
  );
});
