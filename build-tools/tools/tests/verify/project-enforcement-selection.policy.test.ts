#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  injectProjectEnforcementTarget,
  PROJECT_ENFORCEMENT_TARGETS,
  resolveProjectEnforcementSelection,
} from "../../dev/verify/project-enforcement-selection";

test("project enforcement selection covers every authority reason and deduplicates", async () => {
  const select = async (paths: string[], targets = ["//:focused"], fullSuite = false) =>
    resolveProjectEnforcementSelection({
      root: "/fixture",
      requestedTargets: targets,
      fullSuite,
      collectChangedPaths: async () => paths,
    });
  for (const changed of [
    "projects/app/committed.ts",
    "projects/app/staged.ts",
    "projects/app/unstaged.ts",
    "projects/app/untracked.ts",
    "projects/app/renamed.ts",
    "projects/app/deleted.ts",
  ]) {
    assert.equal((await select([changed])).reason, "project-change");
  }
  assert.equal((await select(["README.md"])).required, false);
  assert.equal(
    (await select([], ["//projects/apps/demo/..."])).reason,
    "explicit-project-selector",
  );
  assert.equal((await select([], ["//..."], true)).reason, "full-suite");
  const unavailable = await resolveProjectEnforcementSelection({
    root: "/fixture",
    requestedTargets: ["//:focused"],
    fullSuite: false,
    collectChangedPaths: async () => {
      throw new Error("git unavailable");
    },
  });
  assert.equal(unavailable.reason, "unavailable-change-authority");
  assert.deepEqual(injectProjectEnforcementTarget([PROJECT_ENFORCEMENT_TARGETS], unavailable), [
    PROJECT_ENFORCEMENT_TARGETS,
  ]);
});
