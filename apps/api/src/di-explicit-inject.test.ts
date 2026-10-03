import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The API runs under `node --import tsx` (esbuild emits no decorator metadata), so Nest cannot
// infer constructor dependencies from parameter types. Every DI-created class needs @Inject(Token).
// Classes that modules build only through `useFactory` (`new X(...)`) are exempt.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

function constructorParams(source: string): string[] {
  const start = source.search(/\bconstructor\s*\(/);
  if (start === -1) return [];
  let index = source.indexOf('(', start);
  let depth = 0;
  let current = '';
  const params: string[] = [];
  for (; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === '(' || char === '<' || char === '{' || char === '[') depth += 1;
    if (char === ')' || char === '>' || char === '}' || char === ']') depth -= 1;
    if (depth === 0) break;
    if (char === ',' && depth === 1) {
      params.push(current);
      current = '';
    } else if (!(depth === 1 && char === '(')) {
      current += char;
    }
  }
  params.push(current);
  return params.map((param) => param.trim()).filter(Boolean);
}

describe('explicit Nest DI tokens', () => {
  const files = sourceFiles(join(process.cwd(), 'src'));
  const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
  const factoryBuilt = new Set<string>([
    // Instantiated inline with `new ZodValidationPipe(schema)` in @Body/@Query, never resolved by DI.
    'ZodValidationPipe',
  ]);
  for (const [file, source] of sources) {
    if (!file.endsWith('.module.ts')) continue;
    for (const match of source.matchAll(/provide:\s*(\w+),\s*useFactory/g)) {
      factoryBuilt.add(match[1]!);
    }
  }

  it('requires @Inject on every constructor parameter of DI-created classes', () => {
    const violations: string[] = [];
    for (const [file, source] of sources) {
      const decorated = /@(Controller|Injectable)\(/.exec(source);
      if (!decorated) continue;
      const className = /export class (\w+)/.exec(source.slice(decorated.index))?.[1];
      if (!className || factoryBuilt.has(className)) continue;
      for (const param of constructorParams(source)) {
        if (!/@Inject\(/.test(param)) {
          violations.push(`${file}: ${className}(${param.replace(/\s+/g, ' ')})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('detects the factory-built whitelist from modules', () => {
    expect(factoryBuilt.has('TransactionV2ApplicationService')).toBe(true);
  });
});
