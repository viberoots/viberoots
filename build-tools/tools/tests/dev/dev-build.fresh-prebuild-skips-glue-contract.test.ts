#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readTool(relativePath: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
}

test("dev-build fresh-prebuild fast path is before glue refresh", async () => {
  const source = await readTool("build-tools/tools/dev/dev-build/run-dev-build.ts");

  const decisionIndex = source.indexOf(
    "const materializeDecision = await shouldMaterializeByDefault",
  );
  const fastPathIndex = source.indexOf(
    "[dev-build] fast-path: skipping glue/materialize (${materializeDecision.reason})",
  );
  const materializeGateIndex = source.indexOf("if (!isCI && materialize) {");
  const glueRefreshIndex = source.indexOf("await refreshGlueAndExportGraph(root);");

  assert.notEqual(decisionIndex, -1, "dev-build must compute the materialize policy");
  assert.notEqual(fastPathIndex, -1, "dev-build must log the fresh-prebuild fast path");
  assert.notEqual(materializeGateIndex, -1, "dev-build must gate glue on materialize=true");
  assert.notEqual(glueRefreshIndex, -1, "dev-build must call glue refresh in the stale path");

  assert.ok(
    decisionIndex < fastPathIndex,
    "fast-path logging must be based on the materialize policy decision",
  );
  assert.ok(
    fastPathIndex < materializeGateIndex,
    "fresh-prebuild fast-path logging must happen before the glue/materialize gate",
  );
  assert.ok(
    materializeGateIndex < glueRefreshIndex,
    "glue refresh must stay inside the materialize=true branch",
  );
});

test("dev-build glue refresh remains the only install-deps glue-only caller", async () => {
  const runDevBuild = await readTool("build-tools/tools/dev/dev-build/run-dev-build.ts");
  const glue = await readTool("build-tools/tools/dev/dev-build/glue.ts");
  const needle = "install-deps.ts";
  const glueOnlyNeedle = "--glue-only";

  assert.equal(
    runDevBuild.includes(needle),
    false,
    "run-dev-build must not call install-deps directly on the fresh-prebuild path",
  );
  assert.equal(
    runDevBuild.includes(glueOnlyNeedle),
    false,
    "run-dev-build must not call install-deps --glue-only directly",
  );
  assert.ok(glue.includes(needle), "glue refresh should own the install-deps invocation");
  assert.ok(glue.includes(glueOnlyNeedle), "glue refresh should request glue-only install work");
});

test("dev-build treats generated-only bootstrap graphs as empty prebuilds", async () => {
  const runDevBuild = await readTool("build-tools/tools/dev/dev-build/run-dev-build.ts");
  const glue = await readTool("build-tools/tools/dev/dev-build/glue.ts");

  assert.ok(
    glue.includes("workspaceHasOnlyGeneratedTargets"),
    "glue should distinguish generated-only bootstrap targets from exporter failures",
  );
  assert.ok(
    glue.includes('process.env.DEVBUILD_EMPTY_GRAPH = "1"'),
    "glue should signal an intentionally empty bootstrap graph",
  );
  assert.ok(
    runDevBuild.includes("delete process.env.DEVBUILD_EMPTY_GRAPH;"),
    "dev-build should clear stale empty-graph state before each refresh",
  );
  assert.ok(
    runDevBuild.includes('materializeReason = "empty-bootstrap-graph"'),
    "dev-build should skip graph materialization after an intentionally empty bootstrap export",
  );
});
