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
  assert.match(targets, /@viberoots\/\/:project-enforcement-runner\.ts/);
  assert.match(targets, /template_inputs = \["@viberoots/);
  assert.doesNotMatch(targets, /ignored\.test\.ts/);
  assert.doesNotMatch(targets, /\bnix\b/);
});

test("project enforcement source owns the complete admitted policy runner set", async () => {
  const runners = await discoverProjectEnforcementRunners(viberootsSourcePath(""));
  assert.deepEqual(
    runners.map((runner) => runner.name),
    [
      "project_enforcement_deployment_branches",
      "project_enforcement_deployment_metadata_secrets",
      "project_enforcement_file_size",
      "project_enforcement_process_inspection",
      "project_enforcement_stale_names",
    ],
  );
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
