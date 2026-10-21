// Finds where an exported workflow JSON differs from what the TypeScript, SQL and config would generate.
// Used by test/drift.test.ts, so a hand edit in n8n or a TypeScript change without "npm run build" fails CI.
import type { N8nNode, N8nWorkflow } from './n8n.ts';

const describeNode = (node: N8nNode): string => `"${node.name}" (${node.type.replace('n8n-nodes-base.', '')})`;

export const findDrift = (actual: N8nWorkflow, expected: N8nWorkflow): string[] => {
  const problems: string[] = [];
  const actualNodes = new Map(actual.nodes.map((node) => [node.name, node]));
  for (const want of expected.nodes) {
    const got = actualNodes.get(want.name);
    if (!got) {
      problems.push(`node ${describeNode(want)} is missing from the JSON`);
      continue;
    }
    const gotCode = got.parameters.jsCode;
    const wantCode = want.parameters.jsCode;
    if (wantCode !== undefined && gotCode !== wantCode) {
      problems.push(`Code node ${describeNode(want)} no longer matches its TypeScript source`);
    } else if (want.parameters.query !== undefined && got.parameters.query !== want.parameters.query) {
      problems.push(`Postgres node ${describeNode(want)} no longer matches its SQL file`);
    } else if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`node ${describeNode(want)} has different settings`);
    }
  }
  const expectedNames = new Set(expected.nodes.map((node) => node.name));
  for (const node of actual.nodes) {
    if (!expectedNames.has(node.name)) {
      problems.push(`node ${describeNode(node)} is in the JSON but not in src/build/workflows.ts`);
    }
  }
  if (JSON.stringify(actual.connections) !== JSON.stringify(expected.connections)) {
    problems.push('the connections between nodes differ');
  }
  const header = (workflow: N8nWorkflow): string =>
    JSON.stringify({ ...workflow, nodes: undefined, connections: undefined });
  if (header(actual) !== header(expected)) {
    problems.push('workflow name, id or settings differ');
  }
  return problems;
};
