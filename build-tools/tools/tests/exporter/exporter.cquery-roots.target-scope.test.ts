#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { computeIsolationFlags, computeRootsExpr } from "../../buck/exporter/cquery/runner";
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

test("exporter cquery reuse defaults to per-workspace isolation", async () => {
  await withScopedEnv(
    {
      BUCK_EXPORTER_REUSE_DAEMON: "1",
      BUCK_ISOLATION_DIR_EXPORTER: undefined,
      BUCK_NESTED_ISO: "zxtest-shared-fixture",
      BUCK_ISOLATION_DIR: "verify-pass-fixture",
      BUCK_NO_ISOLATION: undefined,
    },
    async () => {
      const result = computeIsolationFlags(process.cwd());
      assert.match(result.iso, /^exporter-shared-[0-9a-f]{10}$/);
      assert.notEqual(result.iso, "zxtest-shared-fixture");
      assert.notEqual(result.iso, "verify-pass-fixture");
      assert.deepEqual(result.flags, ["--isolation-dir", result.iso]);
      assert.equal(result.ownsIso, false);
    },
  );
});

test("exporter cquery explicit exporter isolation overrides nested isolation", async () => {
  await withScopedEnv(
    {
      BUCK_EXPORTER_REUSE_DAEMON: "1",
      BUCK_ISOLATION_DIR_EXPORTER: "exporter-explicit-fixture",
      BUCK_NESTED_ISO: "zxtest-shared-fixture",
      BUCK_ISOLATION_DIR: "verify-pass-fixture",
      BUCK_NO_ISOLATION: undefined,
    },
    async () => {
      assert.deepEqual(computeIsolationFlags(process.cwd()), {
        iso: "exporter-explicit-fixture",
        flags: ["--isolation-dir", "exporter-explicit-fixture"],
        ownsIso: false,
      });
    },
  );
});
