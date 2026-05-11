#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

/**
 * Closeout validation for the temporary rename inventory.
 *
 * The rename tooling plan requires that the temporary rename inventory used
 * during the repo rename implementation is deleted before merging. Long-term
 * exceptions belong in enforcement allowlists (stale-names-lint.ts
 * ALLOWED_PATHS / ALLOWED_PREFIXES), not in a migration database.
 *
 * This test PASSES when the inventory file is absent — which is the expected
 * state after the rename is complete. If the file reappears, this test fails
 * and reminds contributors to resolve all entries and move them to enforcement
 * allowlists before merging.
 */
test("docs/rename-inventory.md is deleted at rename closeout", async () => {
  let exists = false;
  try {
    await fsp.access("docs/rename-inventory.md");
    exists = true;
  } catch {
    // File absent — expected post-closeout state.
  }
  assert.ok(
    !exists,
    "docs/rename-inventory.md must be deleted at rename closeout. " +
      "Resolve all inventory entries: either rename/remove the stale identifier " +
      "or add a narrow allowlist entry to build-tools/tools/dev/stale-names-lint.ts " +
      "(ALLOWED_PATHS / PLAN_NUMBER_SKIP_PATHS / ALLOWED_PREFIXES) with a reviewed reason. " +
      "Long-term exceptions belong in enforcement allowlists, not a migration database.",
  );
});

test("docs/rename-inventory.json is deleted at rename closeout", async () => {
  let exists = false;
  try {
    await fsp.access("docs/rename-inventory.json");
    exists = true;
  } catch {
    // File absent — expected post-closeout state.
  }
  assert.ok(
    !exists,
    "docs/rename-inventory.json must be deleted at rename closeout. " +
      "Resolve all inventory entries: either rename/remove the stale identifier " +
      "or add a narrow allowlist entry to build-tools/tools/dev/stale-names-lint.ts " +
      "(ALLOWED_PATHS / PLAN_NUMBER_SKIP_PATHS / ALLOWED_PREFIXES) with a reviewed reason.",
  );
});
