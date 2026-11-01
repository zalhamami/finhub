import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('iOS zoom guard', () => {
  it('variables.css raises text inputs to 16px on mobile/touch', () => {
    const css = read('../src/theme/variables.css');
    expect(css).toMatch(/@media \(max-width: 47\.99em\), \(pointer: coarse\)/);
    expect(css).toContain('.mantine-Input-input');
    expect(css).toContain('.mantine-PillsInput-input');
    expect(css).toMatch(/font-size:\s*max\(16px, 1rem\)/);
  });
  it('viewport keeps pinch zoom', () => {
    const html = read('../index.html');
    expect(html).toContain('name="viewport"');
    expect(html).not.toMatch(/maximum-scale|user-scalable/);
  });
});
