#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("deployment install fragments do not kill inherited shared buck isolations", async () => {
  const source = await fsp.readFile(
    "build-tools/tools/tests/deployments/deployment-targets.install.fragments.ts",
    "utf8",
  );

  assert.ok(
    !source.includes('spawnSync("buck2", ["--isolation-dir"'),
    "fragment writes must not kill an inherited BUCK_NESTED_ISO/BUCK_ISOLATION_DIR; use a fresh owned isolation for subsequent queries instead",
  );
});
