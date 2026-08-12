import assert from "node:assert/strict";

export function firstCqueryNode<T>(json: unknown): T | null {
  if (Array.isArray(json)) return (json[0] as T) ?? null;
  if (!json || typeof json !== "object") return null;
  const first = Object.values(json as Record<string, unknown>)[0];
  if (Array.isArray(first)) return (first[0] as T) ?? null;
  return (first as T) ?? null;
}

function cqueryNodes<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (!json || typeof json !== "object") return [];
  return Object.values(json as Record<string, unknown>).flatMap((value) =>
    Array.isArray(value) ? (value as T[]) : [value as T],
  );
}

export async function assertBehaviorProbeCqueryContract(command: any): Promise<void> {
  const fields =
    await command`buck2 cquery --target-platforms //:no_cgo --json --output-attribute behavior_probe "set(//projects/apps/rustapp:lib //projects/apps/rustapp:app //projects/apps/rustapp:test //projects/apps/rustapp:raw //projects/apps/rustapp:wasi //projects/apps/rustapp:wasm_static //projects/apps/rustapp:browser //projects/apps/rustapp:component //projects/apps/rustapp:static //projects/apps/rustapp:dynamic //projects/apps/rustapp:derive_demo //projects/apps/rustapp:pyext //projects/apps/rustapp:addon)"`;
  const nodes = cqueryNodes<{ behavior_probe?: boolean }>(JSON.parse(String(fields.stdout)));
  assert.equal(nodes.length, 13);
  assert.ok(nodes.every((node) => node.behavior_probe === true));
}
