#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { computeRootsExpr } from "../../buck/exporter/cquery/runner";
import { withScopedEnv } from "../lib/test-helpers/scoped-env";

test("exporter cquery roots use BUCK_TARGET for sparse temp workspaces", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-exporter-roots-"));
  try {
    await fsp.mkdir(path.join(tmp, ".git", "objects", "61"), { recursive: true });
    await withScopedEnv(
      {
        BUCK_QUERY_ROOTS: "projects/deployments,projects/apps,projects/libs",
        BUCK_TARGET: "//sandbox/deployments/demo-dev:deploy",
      },
      async () => {
        assert.equal(computeRootsExpr(tmp), "set(//sandbox/deployments/demo-dev:deploy)");
      },
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("exporter cquery roots do not broaden sparse workspaces to //...", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-exporter-roots-"));
  try {
    await fsp.mkdir(path.join(tmp, ".git", "objects", "64"), { recursive: true });
    await withScopedEnv(
      {
        BUCK_QUERY_ROOTS: "projects/deployments,projects/apps,projects/libs",
        BUCK_TARGET: undefined,
      },
      async () => {
        assert.equal(computeRootsExpr(tmp), "set()");
      },
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
