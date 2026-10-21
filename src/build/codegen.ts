// Turns a TypeScript node file (plus the logic files it imports) into one self contained n8n Code node script.
// n8n Code nodes cannot import local files, so the modules are transpiled and concatenated in dependency order.
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// n8n provides Luxon's DateTime as a global inside Code nodes, so that import is dropped.
const N8N_GLOBAL_IMPORTS: Readonly<Record<string, readonly string[]>> = { luxon: ['DateTime'] };

interface ModuleInfo {
  path: string;
  valueImports: string[];
}

const readModule = (path: string): ModuleInfo => {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true);
  const valueImports: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    const typeOnly = clause?.isTypeOnly === true;
    if (specifier.startsWith('.')) {
      if (!typeOnly) {
        valueImports.push(resolve(dirname(path), specifier));
      }
      continue;
    }
    const allowed = N8N_GLOBAL_IMPORTS[specifier];
    const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
      ? clause.namedBindings.elements.map((element) => element.name.text)
      : [];
    if (typeOnly) {
      continue;
    }
    if (!allowed || clause?.name || named.some((name) => !allowed.includes(name))) {
      throw new Error(`${relative(REPO_ROOT, path)} imports "${specifier}", which an n8n Code node cannot load.`);
    }
  }
  return { path, valueImports };
};

// Depth first, so every module appears after the modules it depends on.
const collectModules = (entry: string): string[] => {
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visit = (path: string): void => {
    if (ordered.includes(path)) {
      return;
    }
    if (visiting.has(path)) {
      throw new Error(`Import cycle through ${relative(REPO_ROOT, path)}`);
    }
    visiting.add(path);
    for (const dependency of readModule(path).valueImports) {
      visit(dependency);
    }
    visiting.delete(path);
    ordered.push(path);
  };
  visit(entry);
  return ordered;
};

const transpile = (path: string): string => {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: false,
      verbatimModuleSyntax: false,
    },
  }).outputText;
  const lines = output
    .split('\n')
    .filter((line) => !/^import\s.*;\s*$/.test(line) && !/^export\s*\{\s*\};?\s*$/.test(line))
    .map((line) => line.replace(/^export\s+(const|let|function|class)\s/, '$1 '));
  const leftover = lines.find((line) => /^\s*(import|export)\b/.test(line) || /\brequire\(/.test(line));
  if (leftover !== undefined) {
    throw new Error(`Could not inline ${relative(REPO_ROOT, path)}: "${leftover.trim()}"`);
  }
  return tidy(lines);
};

// The TypeScript printer uses 4 space indents and drops blank lines. Put the repo style back:
// 2 space indents and one blank line before each top level declaration (with its comment).
const tidy = (lines: readonly string[]): string => {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/^(?: {4})+/, (indent) => ' '.repeat(indent.length / 2));
    const topLevel = /^(const|let|function|class|\/\/)/.test(line);
    const previous = out[out.length - 1];
    if (topLevel && previous !== undefined && previous.trim() !== '' && !previous.startsWith('//')) {
      out.push('');
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const topLevelNames = (code: string): string[] =>
  Array.from(code.matchAll(/^(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm), (match) => match[1] ?? '');

export interface CodeNodeSource {
  // Path of the node file relative to the repo root, for example "src/nodes/readCallStatus.ts".
  entry: string;
  // The last lines of the Code node: they read n8n's inputs and call the exported function.
  wrapper: string;
}

export const generateCodeNode = (source: CodeNodeSource): string => {
  const modules = collectModules(resolve(REPO_ROOT, source.entry));
  const seen = new Map<string, string>();
  const sections = modules.map((path) => {
    const name = relative(REPO_ROOT, path);
    const code = transpile(path);
    for (const declared of topLevelNames(code)) {
      const owner = seen.get(declared);
      if (owner !== undefined) {
        throw new Error(`"${declared}" is declared in both ${owner} and ${name}. Rename one of them.`);
      }
      seen.set(declared, name);
    }
    return `// ---- ${name} ----\n${code}`;
  });
  return [
    `// GENERATED by "npm run build" from ${source.entry} and the files it imports. Do not edit here.`,
    '// Change the TypeScript, run "npm run build", then re-import the workflow.',
    '// test/drift.test.ts fails if this code and the TypeScript drift apart.',
    '',
    sections.join('\n\n'),
    '',
    '// ---- n8n entry point ----',
    source.wrapper.trim(),
    '',
  ].join('\n');
};
