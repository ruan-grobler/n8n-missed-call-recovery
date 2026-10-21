import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateCodeNode } from '../src/build/codegen.ts';

let dir = '';
const file = (name: string, source: string): string => {
  const path = join(dir, name);
  writeFileSync(path, source);
  return path;
};

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const fresh = (): void => {
  dir = mkdtempSync(join(tmpdir(), 'codegen-'));
};

describe('generateCodeNode', () => {
  it('inlines dependencies first, drops imports and exports, and keeps comments', () => {
    fresh();
    file('helper.ts', '// helper comment\nexport const double = (value: number): number => value * 2;\n');
    const entry = file('entry.ts', "import { DateTime } from 'luxon';\nimport type { Duration } from 'luxon';\nimport { double } from './helper.ts';\n\nexport const run = (): number => double(DateTime.now().year);\nexport type Unused = Duration;\n");
    const code = generateCodeNode({ entry, wrapper: 'return [{ json: { year: run() } }];' });
    expect(code).toContain('// helper comment\nconst double = (value) => value * 2;');
    expect(code.indexOf('const double')).toBeLessThan(code.indexOf('const run'));
    expect(code).not.toMatch(/^\s*(import|export)\b/m);
    expect(code.trimEnd().endsWith('return [{ json: { year: run() } }];')).toBe(true);
  });

  it('refuses modules an n8n Code node cannot load', () => {
    fresh();
    const fsEntry = file('fs.ts', "import { readFileSync } from 'node:fs';\nexport const run = (): string => String(readFileSync);\n");
    expect(() => generateCodeNode({ entry: fsEntry, wrapper: '' })).toThrow(/cannot load/);
    const luxonDefault = file('lux.ts', "import luxon from 'luxon';\nexport const run = (): unknown => luxon;\n");
    expect(() => generateCodeNode({ entry: luxonDefault, wrapper: '' })).toThrow(/cannot load/);
    const interval = file('interval.ts', "import { Interval } from 'luxon';\nexport const run = (): unknown => Interval;\n");
    expect(() => generateCodeNode({ entry: interval, wrapper: '' })).toThrow(/cannot load/);
  });

  it('refuses two modules that declare the same name', () => {
    fresh();
    file('a.ts', 'export const shared = 1;\n');
    const entry = file('b.ts', "import { shared as other } from './a.ts';\nexport const shared = other + 1;\n");
    expect(() => generateCodeNode({ entry, wrapper: '' })).toThrow(/"shared" is declared in both/);
  });

  it('refuses an import cycle', () => {
    fresh();
    file('x.ts', "import { y } from './y.ts';\nexport const x = (): number => y();\n");
    const entry = file('y.ts', "import { x } from './x.ts';\nexport const y = (): number => x();\n");
    expect(() => generateCodeNode({ entry, wrapper: '' })).toThrow(/Import cycle/);
  });
});
