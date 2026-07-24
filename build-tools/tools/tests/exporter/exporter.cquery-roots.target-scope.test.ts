#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { computeIsolationFlags, computeRootsExpr } from "../../buck/exporter/cquery/runner";
import { artifactGraphQueryRoots } from "../../buck/artifact-graph-query-roots";
import {
  generatedGlobalInputMarker,
  GLOBAL_NIX_INPUT_TARGET_LABELS,
} from "../../lib/global-nix-input-targets";
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

test("exporter cquery roots include only canonical generated global input targets", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-exporter-global-input-roots-"));
  try {
    await Promise.all([
      fsp.mkdir(path.join(tmp, "projects/apps"), { recursive: true }),
      fsp.mkdir(path.join(tmp, "projects/config"), { recursive: true }),
      fsp.mkdir(path.join(tmp, ".viberoots/workspace"), { recursive: true }),
    ]);
    await Promise.all([
      fsp.writeFile(path.join(tmp, "projects/config/TARGETS"), `# ${generatedGlobalInputMarker}\n`),
      fsp.writeFile(
        path.join(tmp, ".viberoots/workspace/TARGETS"),
        `# ${generatedGlobalInputMarker}\n`,
      ),
    ]);
    await withScopedEnv(
      {
        BUCK_QUERY_ROOTS: "projects/apps",
        BUCK_TARGET: undefined,
      },
      async () => {
        assert.equal(
          computeRootsExpr(tmp),
          `set(//projects/apps/... ${GLOBAL_NIX_INPUT_TARGET_LABELS.join(" ")})`,
        );
      },
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("exporter selected-target roots retain canonical generated global identities", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-exporter-selected-globals-"));
  try {
    await Promise.all([
      fsp.mkdir(path.join(tmp, "projects/config"), { recursive: true }),
      fsp.mkdir(path.join(tmp, ".viberoots/workspace"), { recursive: true }),
    ]);
    await Promise.all([
      fsp.writeFile(path.join(tmp, "projects/config/TARGETS"), `# ${generatedGlobalInputMarker}\n`),
      fsp.writeFile(
        path.join(tmp, ".viberoots/workspace/TARGETS"),
        `# ${generatedGlobalInputMarker}\n`,
      ),
    ]);
    await withScopedEnv(
      {
        BUCK_TARGET: "//sandbox/deployments/demo-dev:deploy",
      },
      async () => {
        assert.equal(
          computeRootsExpr(tmp),
          `set(//sandbox/deployments/demo-dev:deploy ${GLOBAL_NIX_INPUT_TARGET_LABELS.join(" ")})`,
        );
      },
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("exporter global TARGETS discovery fails closed on non-ENOENT reads", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-exporter-global-input-read-"));
  try {
    await fsp.mkdir(path.join(tmp, "projects/config/TARGETS"), { recursive: true });
    assert.throws(
      () => computeRootsExpr(tmp),
      (error: NodeJS.ErrnoException) => error.code === "EISDIR",
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("artifact graph roots include the canonical deployment roots", () => {
  const roots = artifactGraphQueryRoots();
  assert.ok(roots.includes("projects/deployments"));
  assert.ok(roots.includes("sandbox/deployments"));
  assert.ok(roots.includes("projects/apps"));
  assert.equal(new Set(roots).size, roots.length);
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
