#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parseDevBuildArgs } from "../../dev/dev-build/args";
import { normalizeDevBuildTargetArgs } from "../../dev/dev-build/target-args";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("dev-build defaults empty build scope to full repo coverage", () => {
  assert.deepEqual(parseDevBuildArgs([]).restArgs, ["//..."]);
  assert.deepEqual(parseDevBuildArgs(["build"]).restArgs, ["//..."]);
  assert.deepEqual(parseDevBuildArgs(["--impure"]).restArgs, ["//..."]);
});

test("dev-build normalizes path-like target args for build/test/run", async () => {
  await runInTemp("dev-build-target-args-normalize", async (tmp) => {
    const graphDir = path.dirname(path.join(tmp, DEFAULT_GRAPH_PATH));
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(
      path.join(tmp, DEFAULT_GRAPH_PATH),
      JSON.stringify(
        [{ name: "//projects/apps/demo:app", labels: ["lang:node", "kind:app"] }],
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(appDir, { recursive: true });

    const fromPath = await normalizeDevBuildTargetArgs({
      workspaceRoot: tmp,
      baseDir: tmp,
      subcmd: "build",
      args: ["projects/apps/demo"],
    });
    assert.deepEqual(fromPath, ["//projects/apps/demo:app"]);

    const fromDot = await normalizeDevBuildTargetArgs({
      workspaceRoot: tmp,
      baseDir: appDir,
      subcmd: "run",
      args: ["."],
    });
    assert.deepEqual(fromDot, ["//projects/apps/demo:app"]);

    const keepExplicit = await normalizeDevBuildTargetArgs({
      workspaceRoot: tmp,
      baseDir: tmp,
      subcmd: "test",
      args: ["//projects/apps/demo:app"],
    });
    assert.deepEqual(keepExplicit, ["//projects/apps/demo:app"]);
  });
});

test("dev-build keeps query expressions and passthrough args untouched", async () => {
  await runInTemp("dev-build-target-args-safe", async (tmp) => {
    const graphDir = path.dirname(path.join(tmp, DEFAULT_GRAPH_PATH));
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(path.join(tmp, DEFAULT_GRAPH_PATH), "[]\n", "utf8");

    const queryArgs = await normalizeDevBuildTargetArgs({
      workspaceRoot: tmp,
      baseDir: tmp,
      subcmd: "query",
      args: ["deps(//projects/apps/demo:app)"],
    });
    assert.deepEqual(queryArgs, ["deps(//projects/apps/demo:app)"]);

    const runArgs = await normalizeDevBuildTargetArgs({
      workspaceRoot: tmp,
      baseDir: tmp,
      subcmd: "run",
      args: ["projects/apps/demo", "--", "./projects/apps/demo/config.json"],
    });
    assert.deepEqual(runArgs, ["//projects/apps/demo", "--", "./projects/apps/demo/config.json"]);

    const withFlagValue = await normalizeDevBuildTargetArgs({
      workspaceRoot: tmp,
      baseDir: tmp,
      subcmd: "build",
      args: ["--target-platforms", "prelude//platforms:default", "projects/apps/demo"],
    });
    assert.deepEqual(withFlagValue, [
      "--target-platforms",
      "prelude//platforms:default",
      "//projects/apps/demo",
    ]);
  });
});

test("dev-build drops missing optional patch recursive scopes", async () => {
  await runInTemp("dev-build-target-args-missing-patches", async (tmp) => {
    const graphDir = path.dirname(path.join(tmp, DEFAULT_GRAPH_PATH));
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(path.join(tmp, DEFAULT_GRAPH_PATH), "[]\n", "utf8");

    const missingPatchScope = await normalizeDevBuildTargetArgs({
      workspaceRoot: tmp,
      baseDir: tmp,
      subcmd: "build",
      args: ["//patches/cpp/..."],
    });
    assert.deepEqual(missingPatchScope, ["//..."]);

    await fsp.mkdir(path.join(tmp, "patches", "cpp"), { recursive: true });
    const existingPatchScope = await normalizeDevBuildTargetArgs({
      workspaceRoot: tmp,
      baseDir: tmp,
      subcmd: "build",
      args: ["//patches/cpp/..."],
    });
    assert.deepEqual(existingPatchScope, ["//patches/cpp/..."]);
  });
});

test("dev-build target normalization defaults to full scope", async () => {
  await runInTemp("dev-build-target-args-default-source-only", async (tmp) => {
    const defaultScope = await normalizeDevBuildTargetArgs({
      workspaceRoot: tmp,
      baseDir: tmp,
      subcmd: "build",
      args: [],
    });
    assert.deepEqual(defaultScope, ["//..."]);
  });
});
