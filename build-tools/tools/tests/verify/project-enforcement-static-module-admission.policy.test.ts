#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { projectEnforcementAdmissionViolations } from "../../lib/project-enforcement-admission";
import { discoverProjectEnforcementRunners } from "../../lib/project-enforcement-registration";

async function runnerRoot(name: string): Promise<{ root: string; dir: string }> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), name));
  const dir = path.join(root, "build-tools/tools/project-enforcement");
  await fsp.mkdir(dir, { recursive: true });
  return { root, dir };
}

test("compact static module declarations retain read-only admission", async () => {
  const { root, dir } = await runnerRoot("project-enforcement-compact-modules-");
  await fsp.writeFile(
    path.join(dir, "good.project-enforcement.test.ts"),
    [
      'import fs from "node:fs"; import { readFile } from "node:fs/promises"; import * as path from "node:path";',
      'import "./side-effect"; import { readHelper } from "./read-helper"; export { readHelper as helper } from "./read-helper";',
      'export * from "./read-export"; void path; await readFile("fixture"); fs.createReadStream("fixture"); await readHelper();',
      "",
    ].join("\n"),
  );
  await fsp.writeFile(path.join(dir, "side-effect.ts"), "export const loaded = true;\n");
  await fsp.writeFile(
    path.join(dir, "read-helper.ts"),
    'import * as fsp from "node:fs/promises"; export async function readHelper() { return await fsp.stat("fixture"); }\n',
  );
  await fsp.writeFile(
    path.join(dir, "read-export.ts"),
    'export { readFile as readExport } from "node:fs/promises";\n',
  );

  const runners = await discoverProjectEnforcementRunners(root);
  assert.deepEqual(await projectEnforcementAdmissionViolations(runners, root), []);
});

test("compact direct and transitive helper graphs cannot conceal mutation", async () => {
  const { root, dir } = await runnerRoot("project-enforcement-helper-graph-");
  await fsp.writeFile(
    path.join(dir, "bad.project-enforcement.test.ts"),
    [
      'import * as fsp from "node:fs/promises"; import { first } from "./first"; first();',
      'function localHelper() { return fsp.rm("local"); } localHelper();',
      "",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(dir, "first.ts"),
    'import { second } from "./second"; export function first() { return second(); }\n',
  );
  await fsp.writeFile(
    path.join(dir, "second.ts"),
    'import { writeFile } from "node:fs/promises"; export function second() { return writeFile("hidden", "value"); }\n',
  );

  const runners = await discoverProjectEnforcementRunners(root);
  const violations = await projectEnforcementAdmissionViolations(runners, root);
  assert.ok(violations.some((line) => line.includes("bad.project-enforcement.test.ts")));
  assert.ok(violations.some((line) => line.includes("second.ts")));
  assert.equal(
    violations.filter((line) => line.includes("filesystem mutation capability")).length,
    2,
  );
});
