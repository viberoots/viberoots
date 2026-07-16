#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ensureProjectEnforcementRegistration } from "../../lib/project-enforcement-registration";
import { processTableLines } from "../../lib/process-inspection";
import { runInTemp } from "../lib/test-helpers";

const allTargets = "workspace_buck//...";
const staleTarget = "workspace_buck//:project_enforcement_stale_names";

type TempShell = Parameters<Parameters<typeof runInTemp>[1]>[1];

async function runBuck($: TempShell, target: string, envOverrides: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env, VERIFY_SKIP_LINT: "1", ...envOverrides };
  const timeoutSeconds = target === allTargets ? 60 : 30;
  return await $({
    env,
    nothrow: true,
    quiet: true,
  })`buck2 test --local-only --no-remote-cache --target-platforms prelude//platforms:default ${target} -- --timeout ${timeoutSeconds}`;
}

async function treeFingerprint(root: string): Promise<string> {
  const rows: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(dir, entry.name);
      const rel = path.relative(root, file).replaceAll(path.sep, "/");
      const stat = await fsp.lstat(file);
      rows.push(
        `${entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f"} ${rel} ${stat.size} ${stat.mtimeMs}`,
      );
      if (entry.isDirectory()) await visit(file);
    }
  };
  await visit(root);
  return crypto.createHash("sha256").update(rows.sort().join("\n")).digest("hex");
}

async function prepareCacheSentinels(root: string): Promise<void> {
  for (const rel of [".direnv", ".nix-gcroots", ".viberoots/cache", "node_modules"]) {
    const dir = path.join(root, rel);
    const stat = await fsp.lstat(dir).catch(() => null);
    if (stat?.isSymbolicLink()) continue;
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, ".project-enforcement-sentinel"), `${rel}\n`);
  }
}

async function cacheFingerprints(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const rel of [".direnv", ".nix-gcroots", ".viberoots/cache", "node_modules"]) {
    result[rel] = await treeFingerprint(path.join(root, rel));
  }
  return result;
}

async function assertCurrentImmutableSource(live: string, immutable: string): Promise<void> {
  assert.match(immutable, /^\/nix\/store\/[^/]+/);
  for (const rel of [
    "build-tools/tools/project-enforcement/project-enforcement-runner.ts",
    "build-tools/tools/lib/project-enforcement-admission.ts",
    "build-tools/tools/project-enforcement/stale-names.project-enforcement.test.ts",
  ]) {
    assert.equal(
      await fsp.readFile(path.join(immutable, rel), "utf8"),
      await fsp.readFile(path.join(live, rel), "utf8"),
      `immutable source is stale: ${rel}`,
    );
  }
}

async function killAndAssertNoOwnedProcesses($: TempShell, root: string): Promise<void> {
  const isolation = String(process.env.BUCK_ISOLATION_DIR || "").trim();
  assert.ok(isolation, "temp consumer must own a Buck isolation");
  await $({ nothrow: true, quiet: true })`buck2 --isolation-dir ${isolation} kill`;
  const lines = await processTableLines({
    psArgs: ["-A", "-ww", "-o", "pid=,command="],
    timeoutMs: 2_000,
  });
  assert.deepEqual(
    lines.filter((line) => line.includes(isolation)),
    [],
  );
}

test("generated local-source runner observes warm consumer edits", async () => {
  await runInTemp("project-enforcement-local-source", async (root, $) => {
    const project = path.join(root, "projects", "apps", "enforcement-fixture");
    const source = path.join(project, "policy.ts");
    await fsp.mkdir(project, { recursive: true });
    await fsp.writeFile(source, 'export const policyName = "current";\n', "utf8");
    const viberootsRoot = String(process.env.VIBEROOTS_ROOT || "").trim();
    assert.ok(viberootsRoot, "temp consumer must expose viberoots source authority");
    assert.doesNotMatch(viberootsRoot, /^\/nix\/store\//);
    await ensureProjectEnforcementRegistration({ workspaceRoot: root, viberootsRoot });

    const initial = await runBuck($, staleTarget);
    assert.equal(initial.exitCode, 0, String(initial.stderr || initial.stdout));

    await fsp.writeFile(source, 'export const policyName = "PR-999";\n', "utf8");
    const rejected = await runBuck($, staleTarget);
    const rejectedOutput = `${String(rejected.stdout || "")}\n${String(rejected.stderr || "")}`;
    assert.notEqual(rejected.exitCode, 0, rejectedOutput);
    assert.match(rejectedOutput, /projects\/apps\/enforcement-fixture\/policy\.ts:1/);
    assert.match(rejectedOutput, /completed-plan PR number/);

    await fsp.writeFile(source, 'export const policyName = "current-again";\n', "utf8");
    const repaired = await runBuck($, staleTarget);
    assert.equal(repaired.exitCode, 0, String(repaired.stderr || repaired.stdout));
    await killAndAssertNoOwnedProcesses($, root);
  });
});

test("generated runner uses the canonical immutable source against a temp consumer", async () => {
  await runInTemp("project-enforcement-remote-source", async (root, $) => {
    const live = String(process.env.VIBEROOTS_ROOT || "").trim();
    const immutable = String(process.env.VIBEROOTS_FLAKE_INPUT_ROOT || "").trim();
    await assertCurrentImmutableSource(live, immutable);
    const source = path.join(root, "projects/apps/enforcement-fixture/policy.ts");
    await fsp.mkdir(path.dirname(source), { recursive: true });
    await fsp.writeFile(source, 'export const policyName = "PR-999";\n');
    await ensureProjectEnforcementRegistration({ workspaceRoot: root, viberootsRoot: immutable });
    const env = {
      VIBEROOTS_ROOT: immutable,
      VIBEROOTS_SOURCE_ROOT: immutable,
    };
    const rejected = await runBuck($, staleTarget, env);
    const output = `${String(rejected.stdout || "")}\n${String(rejected.stderr || "")}`;
    assert.notEqual(rejected.exitCode, 0, output);
    assert.match(output, /projects\/apps\/enforcement-fixture\/policy\.ts:1/);
    await killAndAssertNoOwnedProcesses($, root);
  });
});

test("complete generated pass rejects scanner fixtures and stays bounded when warm", async () => {
  await runInTemp("project-enforcement-complete-pass", async (root, $) => {
    const viberootsRoot = String(process.env.VIBEROOTS_ROOT || "").trim();
    await ensureProjectEnforcementRegistration({ workspaceRoot: root, viberootsRoot });
    const forbiddenProcessSource = ['execSync("', "ps", " -ef", '");\n'].join("");
    const cases = [
      [
        "project_enforcement_process_inspection",
        "projects/apps/demo/process.ts",
        forbiddenProcessSource,
        /direct process-inspection command usage/i,
      ],
      [
        "project_enforcement_deployment_branches",
        "projects/deployments/demo/policy.ts",
        "const stage_branches = {};\n",
        /must not expose stage_branches/i,
      ],
      [
        "project_enforcement_deployment_metadata_secrets",
        "projects/deployments/demo/deployment.bzl",
        'client_secret = "leak"\n',
        /matches .*client_secret/i,
      ],
      [
        "project_enforcement_file_size",
        "projects/apps/demo/oversized.ts",
        "export {};\n".repeat(251),
        /over 250 lines/i,
      ],
    ] as const;
    for (const [name, rel, contents, diagnostic] of cases) {
      const file = path.join(root, rel);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, contents);
      const rejected = await runBuck($, `workspace_buck//:${name}`);
      const output = `${String(rejected.stdout || "")}\n${String(rejected.stderr || "")}`;
      assert.notEqual(rejected.exitCode, 0, `${name} accepted ${rel}: ${output}`);
      assert.ok(output.includes(rel), `${name} did not identify ${rel}: ${output}`);
      assert.match(output, diagnostic);
      await fsp.rm(file);
    }

    await prepareCacheSentinels(root);
    const cachesBefore = await cacheFingerprints(root);
    const nixBefore = new Set(await fsp.readdir("/nix/store"));
    const immutable = String(process.env.VIBEROOTS_FLAKE_INPUT_ROOT || "").trim();
    const immutableBefore = await treeFingerprint(immutable);
    const cold = await runBuck($, allTargets);
    assert.equal(cold.exitCode, 0, String(cold.stderr || cold.stdout));
    const started = performance.now();
    const warm = await runBuck($, allTargets);
    const elapsedMs = performance.now() - started;
    assert.equal(warm.exitCode, 0, String(warm.stderr || warm.stdout));
    assert.ok(elapsedMs <= 60_000, `warm project-enforcement pass took ${elapsedMs.toFixed(0)}ms`);
    assert.deepEqual(await cacheFingerprints(root), cachesBefore);
    assert.equal(await treeFingerprint(immutable), immutableBefore);
    assert.deepEqual(
      (await fsp.readdir("/nix/store")).filter((entry) => !nixBefore.has(entry)),
      [],
    );
    console.log(
      `project-enforcement evidence: warm=${elapsedMs.toFixed(0)}ms new_nix_paths=0 cache_changes=0`,
    );
    await killAndAssertNoOwnedProcesses($, root);
  });
});
