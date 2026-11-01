import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard: colors live in src/theme/tokens.ts only. Anything else must use theme/CSS variables.
const SRC = resolve(__dirname, '../src');
const ALLOWED = new Set(['theme/tokens.ts']);
const HEX = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const FUNC = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function findColorLiterals(source: string): string[] {
  return [...(source.match(HEX) ?? []), ...(source.match(FUNC) ?? [])];
}

describe('no hardcoded colors outside theme/tokens.ts', () => {
  it('detects literals (guard self-test)', () => {
    expect(findColorLiterals('color: #fff;')).toHaveLength(1);
    expect(findColorLiterals("c = '#F5B000'")).toHaveLength(1);
    expect(findColorLiterals('a { b: rgb(1 2 3 / 0.5) }')).toHaveLength(1);
    expect(findColorLiterals('hsl(10, 20%, 30%)')).toHaveLength(1);
    expect(findColorLiterals('var(--mantine-color-amber-5) #rrggbb href="#main"')).toEqual([]);
  });

  it('src/**/*.{ts,tsx,css} are clean', () => {
    const offenders = walk(SRC)
      .filter((f) => /\.(tsx?|css)$/.test(f))
      .map((f) => [relative(SRC, f), f] as const)
      .filter(([rel]) => !ALLOWED.has(rel.replaceAll('\\', '/')))
      .flatMap(([rel, f]) => findColorLiterals(readFileSync(f, 'utf8')).map((m) => `${rel}: ${m}`));
    expect(offenders).toEqual([]);
  });
});
