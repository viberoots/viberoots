#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ensureProjectEnforcementRegistration } from "../../lib/project-enforcement-registration";
import { runInTemp } from "../lib/test-helpers";

const target = "workspace_buck//:project_enforcement_stale_names";

test("generated project enforcement observes warm edits without cleanup", async () => {
  await runInTemp("project-enforcement-freshness", async (root, $) => {
    const project = path.join(root, "projects", "apps", "enforcement-fixture");
    const source = path.join(project, "policy.ts");
    await fsp.mkdir(project, { recursive: true });
    await fsp.writeFile(source, 'export const policyName = "current";\n', "utf8");
    const viberootsRoot = String(process.env.VIBEROOTS_ROOT || "").trim();
    assert.ok(viberootsRoot, "temp consumer must expose viberoots source authority");
    await ensureProjectEnforcementRegistration({ workspaceRoot: root, viberootsRoot });

    const run = async () =>
      await $`buck2 test --local-only --no-remote-cache --target-platforms prelude//platforms:default ${target} -- --timeout 30`.nothrow();
    const initial = await run();
    assert.equal(initial.exitCode, 0, String(initial.stderr || initial.stdout));

    await fsp.writeFile(source, 'export const policyName = "PR-999";\n', "utf8");
    const rejected = await run();
    const rejectedOutput = `${String(rejected.stdout || "")}\n${String(rejected.stderr || "")}`;
    assert.notEqual(rejected.exitCode, 0, rejectedOutput);
    assert.match(rejectedOutput, /projects\/apps\/enforcement-fixture\/policy\.ts:1/);
    assert.match(rejectedOutput, /completed-plan PR number/);

    await fsp.writeFile(source, 'export const policyName = "current-again";\n', "utf8");
    const repaired = await run();
    assert.equal(repaired.exitCode, 0, String(repaired.stderr || repaired.stdout));
  });
});
