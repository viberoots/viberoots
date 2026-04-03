#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { normalizeVerifyTargets } from "../../dev/verify/args.ts";
import { runInTemp } from "../lib/test-helpers.ts";

test("verify normalizes path-like targets from invocation directory", async () => {
  await runInTemp("verify-target-args-normalize", async (tmp) => {
    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
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

test("verify normalizes root zx test file paths to generated root labels", async () => {
  await runInTemp("verify-target-args-root-zx-file", async (tmp) => {
    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
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
    assert.deepEqual(normalized, ["//:deployments_nixos_shared_host_deploy_remote_exec"]);
  });
});

test("verify keeps explicit labels and query expressions untouched", async () => {
  await runInTemp("verify-target-args-safe", async (tmp) => {
    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
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

test("verify normalizes root '.' target to full-suite wildcard", async () => {
  await runInTemp("verify-target-args-root-dot", async (tmp) => {
    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
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
