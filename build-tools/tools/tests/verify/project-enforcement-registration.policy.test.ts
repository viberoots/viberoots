#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ensureProjectEnforcementRegistration,
  PROJECT_ENFORCEMENT_LABEL,
} from "../../lib/project-enforcement-registration";

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
