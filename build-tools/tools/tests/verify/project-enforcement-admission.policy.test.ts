#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { projectEnforcementAdmissionViolations } from "../../lib/project-enforcement-admission";
import { discoverProjectEnforcementRunners } from "../../lib/project-enforcement-registration";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("all suffix-owned project-enforcement runners satisfy structural admission", async () => {
  const root = viberootsSourcePath("");
  const runners = await discoverProjectEnforcementRunners(root);
  assert.deepEqual(await projectEnforcementAdmissionViolations(runners, root), []);
});

test("structural admission follows imports and rejects every prohibited workload class", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-enforcement-admission-"));
  const runnerDir = path.join(root, "build-tools/tools/project-enforcement");
  await fsp.mkdir(runnerDir, { recursive: true });
  await fsp.writeFile(
    path.join(runnerDir, "bad.project-enforcement.test.ts"),
    'import "./heavy";\n',
  );
  await fsp.writeFile(
    path.join(runnerDir, "heavy.ts"),
    [
      'import "node:https";',
      'export * from "./transitive";',
      'runInTemp("consumer", async () => {});',
      'const commands = ["nix build", "pnpm install", "buck2 test"];',
      'await $`${commands.join(";")}`;',
      "createServer().listen(0);",
      "",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(runnerDir, "transitive.ts"),
    [
      'import { execFileSync } from "node:child_process";',
      'execFileSync(process.env.TOOL || "nix", ["build"]);',
      "",
    ].join("\n"),
  );
  const runners = await discoverProjectEnforcementRunners(root);
  const violations = await projectEnforcementAdmissionViolations(runners, root);
  assert.match(violations.join("\n"), /temp consumer creation/);
  assert.match(violations.join("\n"), /imports unsupported capability node:https/);
  assert.match(violations.join("\n"), /imports unsupported capability node:child_process/);
  assert.match(violations.join("\n"), /heavy tool execution/);
  assert.match(violations.join("\n"), /unreviewed command execution/);
  assert.match(violations.join("\n"), /service startup/);
  assert.match(violations.join("\n"), /service listener startup/);
});
