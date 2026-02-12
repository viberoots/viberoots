#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("verify includes a bounded lint preflight (enforcement)", async () => {
  const txt = await fsp.readFile("build-tools/tools/dev/verify/lint-preflight.ts", "utf8");
  assert.ok(
    txt.includes("lint preflight"),
    "expected build-tools/tools/bin/verify to include a lint preflight to avoid wasting time on verify when formatting/lint is dirty",
  );
  assert.ok(
    txt.includes("VERIFY_LINT_TIMEOUT_SECS"),
    "expected build-tools/tools/bin/verify to bound lint preflight runtime via VERIFY_LINT_TIMEOUT_SECS",
  );
  assert.ok(
    txt.includes("timeout -k 10s"),
    "expected build-tools/tools/bin/verify lint preflight to use timeout -k 10s to avoid indefinite hangs",
  );
  assert.ok(
    txt.includes("nix-gaps-inventory-check.ts"),
    "expected verify preflight to run nix-gaps inventory policy checks",
  );
  assert.ok(
    txt.includes("--starlark-api") &&
      txt.includes("docs/handbook/starlark-api.md") &&
      txt.includes("--nix-gaps") &&
      txt.includes("docs/handbook/nix-gaps.md") &&
      txt.includes("--exceptions") &&
      txt.includes("docs/handbook/nix-gaps-exceptions.json"),
    "expected verify preflight to invoke nix-gaps policy checker with canonical docs paths",
  );
});
