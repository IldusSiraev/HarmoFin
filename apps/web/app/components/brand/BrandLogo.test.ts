import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BrandLogo from './BrandLogo.vue';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compileStyle, parse } from 'vue/compiler-sfc';

describe('BrandLogo', () => {
  it('compiles an actual dark-theme path selector and explicit inverse override', () => {
    const source = readFileSync(path.join(__dirname, 'BrandLogo.vue'), 'utf8');
    const { descriptor } = parse(source);
    const css = descriptor.styles
      .map(
        (style) =>
          compileStyle({
            source: style.content,
            filename: 'BrandLogo.vue',
            id: 'data-v-brand',
            scoped: !!style.scoped,
          }).code,
      )
      .join('\n');
    expect(css).toMatch(/\[data-theme=['"]dark['"]\] \.brand-logo path\s*\{\s*fill: currentColor/);
    expect(css).toContain('.brand-logo--inverse');
  });
  it('has one accessible name and fixed geometry without a font dependency', () => {
    const wrapper = mount(BrandLogo);
    expect(wrapper.attributes('role')).toBe('img');
    expect(wrapper.attributes('aria-label')).toBe('HarmoFin');
    expect(wrapper.attributes('focusable')).toBe('false');
    expect(wrapper.attributes('viewBox')).toBe('0 0 510 128');
    expect(wrapper.findAll('text')).toHaveLength(0);
    expect(wrapper.findAll('path')).toHaveLength(4);
    expect(wrapper.findAll('path[fill="currentColor"]')).toHaveLength(2);
  });

  it('keeps the same paths for compact and always-inverse contexts', () => {
    const normal = mount(BrandLogo);
    const inverse = mount(BrandLogo, { props: { inverse: true, compact: true } });
    expect(inverse.classes()).toContain('brand-logo--inverse');
    expect(inverse.classes()).toContain('brand-logo--compact');
    expect(inverse.findAll('path').map((p) => p.attributes('d'))).toEqual(
      normal.findAll('path').map((p) => p.attributes('d')),
    );
  });
});
