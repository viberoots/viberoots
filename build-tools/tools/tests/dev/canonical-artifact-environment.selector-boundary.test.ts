#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { withoutArtifactEnvironmentInfluence } from "../../lib/artifact-environment";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("selected builds reject ambient graph selectors before exporting a graph", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      viberootsSourcePath("build-tools/tools/dev/zx-init.mjs"),
      viberootsSourcePath("build-tools/tools/dev/build-selected.ts"),
      "--source=git",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...withoutArtifactEnvironmentInfluence(process.env),
        NODE_OPTIONS: "",
        BUCK_TARGET: "//:ambient-selector-canary",
        BUCK_QUERY_ROOTS: "host-only-root",
        BUCK_TARGET_ATTR: "host_attr",
        BUCK_TARGET_PLATFORM: "host-platform",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    String(result.stderr || ""),
    /artifact build rejects ambient selectors: BUCK_QUERY_ROOTS, BUCK_TARGET, BUCK_TARGET_ATTR, BUCK_TARGET_PLATFORM/,
  );
  assert.doesNotMatch(String(result.stderr || ""), /exporting graph/);
});
