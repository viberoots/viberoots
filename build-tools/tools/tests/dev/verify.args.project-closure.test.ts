#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVerifyArgs } from "../../dev/verify/args.ts";

test("verify args: project-closure parses repeated flags and explain-selection", () => {
  const parsed = parseVerifyArgs({
    argvTokens: [
      "--selector",
      "project-closure",
      "--project",
      "projects/apps/tangram",
      "--projects=projects/libs/ui,projects/libs/theme",
      "--explain-selection",
    ],
    env: {},
  });

  assert.equal(parsed.selector, "project-closure");
  assert.equal(parsed.explainSelection, true);
  assert.deepEqual(parsed.requestedProjects, [
    "projects/apps/tangram",
    "projects/libs/theme",
    "projects/libs/ui",
  ]);
  assert.deepEqual(parsed.targets, ["//..."]);
});

test("verify args: env aliases apply when CLI selector flags are absent", () => {
  const parsed = parseVerifyArgs({
    argvTokens: [],
    env: {
      VERIFY_SELECTOR: "project-closure",
      VERIFY_PROJECTS: "projects/apps/tangram,projects/libs/ui",
    },
  });

  assert.equal(parsed.selector, "project-closure");
  assert.deepEqual(parsed.requestedProjects, ["projects/apps/tangram", "projects/libs/ui"]);
});

test("verify args: CLI selector inputs override env aliases", () => {
  const parsed = parseVerifyArgs({
    argvTokens: ["--selector=project-closure", "--project", "projects/apps/admin"],
    env: {
      VERIFY_SELECTOR: "project-closure",
      VERIFY_PROJECTS: "projects/apps/tangram",
    },
  });

  assert.deepEqual(parsed.requestedProjects, ["projects/apps/admin"]);
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
        argvTokens: ["--selector=project-closure", "--project", "projects/apps/tangram", "//..."],
        env: {},
      }),
    /cannot be combined with explicit Buck targets/,
  );
});
