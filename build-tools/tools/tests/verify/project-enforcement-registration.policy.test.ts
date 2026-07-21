#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  discoverProjectEnforcementRunners,
  ensureProjectEnforcementRegistration,
  PROJECT_ENFORCEMENT_LABEL,
} from "../../lib/project-enforcement-registration";
import { ensureWorkspaceBuckStatePackage } from "../../lib/workspace-buck-state";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("project enforcement registration discovers suffix runners without Nix", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-enforcement-registration-"));
  const viberootsRoot = path.join(root, "source");
  const runners = path.join(viberootsRoot, "build-tools/tools/project-enforcement");
  await fsp.mkdir(runners, { recursive: true });
  await fsp.writeFile(path.join(runners, "alpha.project-enforcement.test.ts"), "export {};\n");
  await fsp.writeFile(path.join(runners, "ignored.test.ts"), "export {};\n");

  const result = await ensureProjectEnforcementRegistration({
    workspaceRoot: root,
    viberootsRoot,
  });
  const targets = await fsp.readFile(path.join(root, ".viberoots/workspace/buck/TARGETS"), "utf8");
  assert.deepEqual(
    result.map((runner) => runner.name),
    ["project_enforcement_alpha"],
  );
  assert.match(targets, new RegExp(PROJECT_ENFORCEMENT_LABEL));
  assert.match(
    targets,
    /@viberoots\/\/build-tools\/tools\/project-enforcement:project-enforcement-runner\.ts/,
  );
  assert.match(targets, /template_inputs = \["@viberoots/);
  assert.match(
    targets,
    /viberoots_script_path = "build-tools\/tools\/project-enforcement\/project-enforcement-runner\.ts"/,
  );
  assert.doesNotMatch(targets, /ignored\.test\.ts/);
  assert.doesNotMatch(targets, /\bnix\b/);
});

test("project enforcement registration follows suffix additions and removals", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-enforcement-membership-"));
  const source = path.join(root, "source");
  const runnerDir = path.join(source, "build-tools/tools/project-enforcement");
  await fsp.mkdir(runnerDir, { recursive: true });
  const alpha = path.join(runnerDir, "alpha.project-enforcement.test.ts");
  const beta = path.join(runnerDir, "beta.project-enforcement.test.ts");
  await fsp.writeFile(alpha, "export {};\n");
  await ensureProjectEnforcementRegistration({ workspaceRoot: root, viberootsRoot: source });
  await fsp.writeFile(beta, "export {};\n");
  await ensureProjectEnforcementRegistration({ workspaceRoot: root, viberootsRoot: source });
  await fsp.rm(alpha);
  const runners = await ensureProjectEnforcementRegistration({
    workspaceRoot: root,
    viberootsRoot: source,
  });
  const targets = await fsp.readFile(path.join(root, ".viberoots/workspace/buck/TARGETS"), "utf8");
  assert.deepEqual(
    runners.map((runner) => runner.name),
    ["project_enforcement_beta"],
  );
  assert.match(targets, /project_enforcement_beta/);
  assert.doesNotMatch(targets, /project_enforcement_alpha/);
});

test("workspace graph output identity follows canonical content", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-enforcement-graph-source-"));
  const source = path.join(root, "source");
  const runnerDir = path.join(source, "build-tools/tools/project-enforcement");
  const graphDir = path.join(root, ".viberoots/workspace/buck");
  await fsp.mkdir(runnerDir, { recursive: true });
  await fsp.mkdir(graphDir, { recursive: true });
  await fsp.writeFile(path.join(runnerDir, "alpha.project-enforcement.test.ts"), "export {};\n");
  await fsp.writeFile(path.join(graphDir, "graph.json"), '[{"label":"first"}]\n');

  await ensureProjectEnforcementRegistration({ workspaceRoot: root, viberootsRoot: source });
  const firstTargets = await fsp.readFile(path.join(graphDir, "TARGETS"), "utf8");
  const firstDigest = firstTargets.match(/out = "graph\.([a-f0-9]{64})\.json"/)?.[1];
  assert.ok(firstDigest);
  assert.match(firstTargets, /export_file\(name = "graph\.json"/);
  assert.match(firstTargets, /src = "graph\.json"/);

  await fsp.writeFile(path.join(graphDir, "graph.json"), '[{"label":"second"}]\n');
  await ensureProjectEnforcementRegistration({ workspaceRoot: root, viberootsRoot: source });
  const secondTargets = await fsp.readFile(path.join(graphDir, "TARGETS"), "utf8");
  const secondDigest = secondTargets.match(/out = "graph\.([a-f0-9]{64})\.json"/)?.[1];
  assert.ok(secondDigest);
  assert.notEqual(secondDigest, firstDigest);
  assert.doesNotMatch(secondTargets, new RegExp(`graph\\.${firstDigest}\\.json`));
  assert.deepEqual(
    (await fsp.readdir(graphDir)).filter((entry) => /^graph\.[a-f0-9]{64}\.json$/.test(entry)),
    [],
  );
});

test("project enforcement exports and registration share suffix discovery", async () => {
  const root = viberootsSourcePath("");
  const runnerDir = path.join(root, "build-tools/tools/project-enforcement");
  const suffixFiles = (await fsp.readdir(runnerDir))
    .filter((file) => file.endsWith(".project-enforcement.test.ts"))
    .sort();
  const runners = await discoverProjectEnforcementRunners(root);
  assert.deepEqual(
    runners.map((runner) => path.basename(runner.sourcePath)),
    suffixFiles,
  );
  const targets = await fsp.readFile(path.join(runnerDir, "TARGETS"), "utf8");
  assert.match(targets, /glob\(\["\*\.project-enforcement\.test\.ts"\]\)/);
  for (const file of suffixFiles) assert.doesNotMatch(targets, new RegExp(`"${file}"`));
});

test("verify target planning creates the complete workspace Buck package before cquery", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-workspace-buck-state-"));
  try {
    await ensureWorkspaceBuckStatePackage(root);
    assert.equal(
      await fsp.readFile(path.join(root, ".viberoots/workspace/buck/graph.json"), "utf8"),
      "[]\n",
    );

    const source = await fsp.readFile(
      viberootsSourcePath("build-tools/tools/dev/verify/target-passes.ts"),
      "utf8",
    );
    assert.ok(
      source.indexOf("await ensureWorkspaceBuckStatePackage(opts.root)") <
        source.indexOf("const targetLabels = loadVerifyTargetLabels(opts)"),
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
