#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node test buildPhase decodes and forwards explicit vitest patterns", async () => {
  const nixExpr = await fsp.readFile("build-tools/tools/nix/flake/packages/node-test.nix", "utf8");
  const script = await fsp.readFile(
    "build-tools/tools/nix/flake/packages/node-test-buildPhase.sh",
    "utf8",
  );

  if (!nixExpr.includes("export PATTERNS_VALUE='${builtins.toJSON patternsValue}'")) {
    throw new Error("node-test.nix must export PATTERNS_VALUE as a quoted JSON string");
  }

  if (!nixExpr.includes("patternsValue = patternsEnv;")) {
    throw new Error("node-test.nix must only forward explicit caller-supplied patterns to vitest");
  }

  if (!script.includes("process.env.PATTERNS_VALUE ??")) {
    throw new Error("node-test buildPhase must decode PATTERNS_VALUE from the environment");
  }

  if (!script.includes("const parsed = JSON.parse(raw);")) {
    throw new Error("node-test buildPhase must decode PATTERNS_VALUE from the environment");
  }

  if (!script.includes("mapfile -t PATTERN_ARGS < <(node -e")) {
    throw new Error("node-test buildPhase must materialize explicit vitest pattern arguments");
  }

  if (!script.includes('"${PATTERN_ARGS[@]}"')) {
    throw new Error("node-test buildPhase must forward pattern arguments to vitest");
  }

  if (!script.includes('"${COVERAGE_ARGS[@]}"')) {
    throw new Error("node-test buildPhase must forward coverage flags as discrete arguments");
  }

  if (
    !script.includes(
      'VITEST_TIMEOUT_SECS="${TEST_NIX_TIMEOUT_SECS:-${VERIFY_TIMEOUT_SECS:-${NIX_PNPM_INSTALL_TIMEOUT:-1800}}}"',
    )
  ) {
    throw new Error(
      "node-test buildPhase must derive vitest timeout from the active test/install budget",
    );
  }

  if (script.includes("VITEST_TIMEOUT_SECS=420")) {
    throw new Error("node-test buildPhase must not clamp vitest to a hardcoded 420s timeout");
  }

  if (script.includes("${PATTERNS_VALUE}")) {
    throw new Error("node-test buildPhase must not leave PATTERNS_VALUE as a literal placeholder");
  }
});
