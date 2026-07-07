#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  allTestsTargetsForWorkspace,
  resolveRequestedVerifyScope,
} from "../../dev/verify/requested-scope";
import type { VerifyArgs } from "../../dev/verify/args";

const defaultArgs: VerifyArgs = {
  coverage: false,
  console: "auto",
  targets: ["//..."],
  selector: "default",
  requestedProjects: [],
  explainSelection: false,
};

test("ALL_TESTS forces the default verify selector to all Buck tests", async () => {
  const env = { ALL_TESTS: "1" };
  const resolved = await resolveRequestedVerifyScope({
    root: process.cwd(),
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env,
    deps: {
      resolveTemplateScope: async () => {
        throw new Error("template scope should be bypassed");
      },
    },
  });

  assert.equal(resolved.selection.selectorMode, "all-tests");
  assert.equal(resolved.selection.reason, "all-tests-env");
  assert.deepEqual(
    resolved.selection.targets,
    allTestsTargetsForWorkspace({ root: process.cwd(), env }),
  );
});

test("ALL_TESTS=true is accepted as the all-tests override", async () => {
  const env = { ALL_TESTS: "true", VBR_DEPLOYMENT_TEST_SCOPE: "never" };
  const resolved = await resolveRequestedVerifyScope({
    root: process.cwd(),
    invocationCwd: process.cwd(),
    args: defaultArgs,
    env,
    deps: {
      resolveTemplateScope: async () => {
        throw new Error("template scope should be bypassed");
      },
    },
  });

  assert.equal(resolved.selection.selectorMode, "all-tests");
  assert.equal(resolved.selection.requestedDeploymentMode, "never");
  assert.deepEqual(
    resolved.selection.targets,
    allTestsTargetsForWorkspace({ root: process.cwd(), env }),
  );
});

test("ALL_TESTS includes local non-infrastructure cells for non-flake installs", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-all-tests-local-cells-"));
  try {
    await fsp.writeFile(path.join(tmp, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    await fsp.mkdir(path.join(tmp, ".viberoots"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "viberoots"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "viberoots", "prelude"), { recursive: true });
    await fsp.symlink(path.join(tmp, "viberoots"), path.join(tmp, ".viberoots", "current"));
    await fsp.writeFile(
      path.join(tmp, ".buckconfig"),
      [
        "[cells]",
        "root = .",
        "viberoots = ./.viberoots/current",
        "prelude = ./.viberoots/current/prelude",
        "workspace_buck = ./.viberoots/workspace/buck",
        "",
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(allTestsTargetsForWorkspace({ root: tmp, env: {} }), [
      "//...",
      "viberoots//...",
    ]);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("ALL_TESTS remains root-only for flake-installed remote viberoots", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-all-tests-remote-cells-"));
  try {
    await fsp.writeFile(path.join(tmp, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    await fsp.writeFile(
      path.join(tmp, ".buckconfig"),
      ["[cells]", "root = .", "viberoots = ./.viberoots/current", ""].join("\n"),
      "utf8",
    );

    assert.deepEqual(
      allTestsTargetsForWorkspace({
        root: tmp,
        env: { VIBEROOTS_ROOT: "/nix/store/example-viberoots-source" },
      }),
      ["//..."],
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
