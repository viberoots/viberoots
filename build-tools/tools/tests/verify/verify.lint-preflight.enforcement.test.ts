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
    txt.includes("collectChangedPaths"),
    "expected verify lint preflight to scope lint/prettier to changed files by default",
  );
  assert.ok(
    txt.includes("/dist/") && txt.includes('startsWith("dist/")'),
    "expected verify lint preflight to ignore generated dist outputs",
  );
  assert.ok(
    txt.includes("--no-warn-ignored"),
    "expected verify lint preflight to suppress ignored-file warnings for explicit changed-file runs",
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
    txt.includes("file-size-lint.ts"),
    "expected verify preflight to run strict source file-size checks",
  );
  assert.ok(
    txt.includes("--scope=source") && txt.includes("--fail=true"),
    "expected verify preflight to pass strict source file-size args",
  );
  assert.equal(
    txt.includes("--scope=ssr-tests"),
    false,
    "expected verify preflight to avoid legacy SSR-only file-size scope wiring",
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

test("verify lint-preflight invokes stale-names-lint for full active-source scan (enforcement)", async () => {
  const txt = await fsp.readFile("build-tools/tools/dev/verify/lint-preflight.ts", "utf8");

  // The preflight module must call the stale-names-lint step.
  assert.ok(
    txt.includes("stale-names-lint.ts"),
    "expected verify lint-preflight to invoke stale-names-lint.ts so active source is scanned for stale repo names, plan numbers, and migration labels before Buck tests run",
  );

  // The preflight step must run the full-source scan, not just staged-file mode.
  assert.ok(
    txt.includes('"--full"') || txt.includes("'--full'") || txt.includes("--full"),
    "expected verify stale-names preflight to pass --full so the entire active source tree is scanned rather than only staged files",
  );

  // The preflight must emit a recognisable diagnostic label so operators know which step failed.
  assert.ok(
    txt.includes("stale-names preflight"),
    "expected verify lint-preflight to log a 'stale-names preflight' label so operators can identify the failing step from verify output",
  );

  // The preflight must exit non-zero on failures — confirmed by the error-path exit call.
  assert.ok(
    txt.includes("stale-names preflight failed") || txt.includes("process.exit(2)"),
    "expected verify stale-names preflight to call process.exit(2) on failure so verify aborts with an actionable non-zero exit code",
  );
});
