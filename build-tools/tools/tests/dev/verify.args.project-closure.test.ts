#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVerifyArgs } from "../../dev/verify/args";

test("verify args: project-closure parses repeated flags and explain-selection", () => {
  const parsed = parseVerifyArgs({
    argvTokens: [
      "--selector",
      "project-closure",
      "--project",
      "workspace/apps/puzzle",
      "--projects=workspace/libs/ui,workspace/libs/theme",
      "--explain-selection",
    ],
    env: {},
  });

  assert.equal(parsed.selector, "project-closure");
  assert.equal(parsed.explainSelection, true);
  assert.deepEqual(parsed.requestedProjects, [
    "workspace/apps/puzzle",
    "workspace/libs/theme",
    "workspace/libs/ui",
  ]);
  assert.deepEqual(parsed.targets, ["//..."]);
});

test("verify args: explain-selection is allowed in default mode", () => {
  const parsed = parseVerifyArgs({
    argvTokens: ["--explain-selection"],
    env: {},
  });

  assert.equal(parsed.selector, "default");
  assert.equal(parsed.explainSelection, true);
  assert.deepEqual(parsed.requestedProjects, []);
  assert.deepEqual(parsed.targets, ["//..."]);
});

test("verify args: env aliases apply when CLI selector flags are absent", () => {
  const parsed = parseVerifyArgs({
    argvTokens: [],
    env: {
      VERIFY_SELECTOR: "project-closure",
      VERIFY_PROJECTS: "workspace/apps/puzzle,workspace/libs/ui",
    },
  });

  assert.equal(parsed.selector, "project-closure");
  assert.deepEqual(parsed.requestedProjects, ["workspace/apps/puzzle", "workspace/libs/ui"]);
});

test("verify args: CLI selector inputs override env aliases", () => {
  const parsed = parseVerifyArgs({
    argvTokens: ["--selector=project-closure", "--project", "workspace/apps/admin"],
    env: {
      VERIFY_SELECTOR: "project-closure",
      VERIFY_PROJECTS: "workspace/apps/puzzle",
    },
  });

  assert.deepEqual(parsed.requestedProjects, ["workspace/apps/admin"]);
});

test("verify args: project-closure requires projects and rejects explicit targets", () => {
  assert.throws(
    () =>
      parseVerifyArgs({
        argvTokens: ["--selector=project-closure"],
        env: {},
      }),
    /requires at least one --project or --projects value/,
  );

  assert.throws(
    () =>
      parseVerifyArgs({
        argvTokens: ["--selector=project-closure", "--project", "workspace/apps/puzzle", "//..."],
        env: {},
      }),
    /cannot be combined with explicit Buck targets/,
  );
});
