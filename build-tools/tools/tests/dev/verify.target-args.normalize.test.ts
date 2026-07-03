#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { normalizeVerifyTargets } from "../../dev/verify/args";
import { runInTemp } from "../lib/test-helpers";

test("verify normalizes path-like targets from invocation directory", async () => {
  await runInTemp("verify-target-args-normalize", async (tmp) => {
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [{ name: "//projects/apps/demo:app", labels: ["lang:node", "kind:app"] }],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const appDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(appDir, { recursive: true });

    const fromDot = await normalizeVerifyTargets({
      workspaceRoot: tmp,
      baseDir: appDir,
      targets: ["."],
    });
    assert.deepEqual(fromDot, ["//projects/apps/demo/..."]);

    const fromRelPath = await normalizeVerifyTargets({
      workspaceRoot: tmp,
      baseDir: tmp,
      targets: ["projects/apps/demo"],
    });
    assert.deepEqual(fromRelPath, ["//projects/apps/demo/..."]);
  });
});

test("verify normalizes root zx test file paths to active viberoots labels", async () => {
  await runInTemp("verify-target-args-root-zx-file", async (tmp) => {
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(path.join(graphDir, "graph.json"), "[]\n", "utf8");

    const testFile = path.join(
      tmp,
      "build-tools",
      "tools",
      "tests",
      "deployments",
      "nixos-shared-host.deploy.remote-exec.test.ts",
    );
    await fsp.mkdir(path.dirname(testFile), { recursive: true });
    await fsp.writeFile(testFile, "// test fixture\n", "utf8");

    const normalized = await normalizeVerifyTargets({
      workspaceRoot: tmp,
      baseDir: tmp,
      targets: ["build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-exec.test.ts"],
    });
    assert.deepEqual(normalized, ["viberoots//:deployments_nixos_shared_host_deploy_remote_exec"]);
  });
});

test("verify normalizes nested viberoots zx test file paths to viberoots cell labels", async () => {
  await runInTemp("verify-target-args-nested-viberoots-zx-file", async (tmp) => {
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(path.join(graphDir, "graph.json"), "[]\n", "utf8");

    const testFile = path.join(
      tmp,
      "viberoots",
      "build-tools",
      "tools",
      "tests",
      "dev",
      "status-watch-alias.s.test.ts",
    );
    await fsp.mkdir(path.dirname(testFile), { recursive: true });
    await fsp.writeFile(testFile, "// test fixture\n", "utf8");

    const fromRootRelative = await normalizeVerifyTargets({
      workspaceRoot: tmp,
      baseDir: tmp,
      targets: ["build-tools/tools/tests/dev/status-watch-alias.s.test.ts"],
    });
    assert.deepEqual(fromRootRelative, ["viberoots//:dev_status_watch_alias_s"]);

    const fromNestedRelative = await normalizeVerifyTargets({
      workspaceRoot: tmp,
      baseDir: path.join(tmp, "viberoots"),
      targets: ["build-tools/tools/tests/dev/status-watch-alias.s.test.ts"],
    });
    assert.deepEqual(fromNestedRelative, ["viberoots//:dev_status_watch_alias_s"]);
  });
});

test("verify keeps explicit labels and query expressions untouched", async () => {
  await runInTemp("verify-target-args-safe", async (tmp) => {
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(path.join(graphDir, "graph.json"), "[]\n", "utf8");

    const keepExplicit = await normalizeVerifyTargets({
      workspaceRoot: tmp,
      baseDir: tmp,
      targets: ["//projects/apps/demo:app"],
    });
    assert.deepEqual(keepExplicit, ["//projects/apps/demo:app"]);

    const keepQuery = await normalizeVerifyTargets({
      workspaceRoot: tmp,
      baseDir: tmp,
      targets: ["deps(//projects/apps/demo:app)"],
    });
    assert.deepEqual(keepQuery, ["deps(//projects/apps/demo:app)"]);
  });
});

test("verify qualifies explicit nested viberoots labels in consumer workspaces", async () => {
  await runInTemp("verify-target-args-nested-viberoots-labels", async (tmp) => {
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(path.join(graphDir, "graph.json"), "[]\n", "utf8");
    await fsp.mkdir(path.join(tmp, "viberoots"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "viberoots", "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const fromRootLabel = await normalizeVerifyTargets({
      workspaceRoot: tmp,
      baseDir: path.join(tmp, "viberoots"),
      targets: ["//:planner_nixpkgs_source_selection_identity"],
    });
    assert.deepEqual(fromRootLabel, ["viberoots//:planner_nixpkgs_source_selection_identity"]);

    const fromPackageLabel = await normalizeVerifyTargets({
      workspaceRoot: tmp,
      baseDir: path.join(tmp, "viberoots", "build-tools", "tools"),
      targets: [":tooling_unit"],
    });
    assert.deepEqual(fromPackageLabel, ["viberoots//build-tools/tools:tooling_unit"]);
  });
});

test("verify normalizes root '.' target to full-suite wildcard", async () => {
  await runInTemp("verify-target-args-root-dot", async (tmp) => {
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(path.join(graphDir, "graph.json"), "[]\n", "utf8");

    const fromRootDot = await normalizeVerifyTargets({
      workspaceRoot: tmp,
      baseDir: tmp,
      targets: ["."],
    });
    assert.deepEqual(fromRootDot, ["//..."]);
  });
});
