#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

type InventoryEntry = {
  "stale-token": string;
  replacement: string;
  "mechanical-replacement-safe": boolean;
  reviewed: boolean;
  resolution: "renamed" | "removed" | "retained-in-allowlist";
};

function validateInventory(entries: InventoryEntry[]): string[] {
  const errors: string[] = [];
  const replacements = new Map<string, string>();
  for (const entry of entries) {
    const staleToken = entry["stale-token"];
    const prior = replacements.get(staleToken);
    if (prior != null && prior !== entry.replacement) {
      errors.push(`${staleToken} has conflicting replacements: ${prior} vs ${entry.replacement}`);
    }
    replacements.set(staleToken, entry.replacement);
    if (/(common|legacy|v1|v2|PR-\d+|phase\d+)/i.test(staleToken)) {
      assert.equal(
        entry["mechanical-replacement-safe"],
        false,
        `${staleToken} is context-sensitive and cannot be marked mechanical-replacement-safe`,
      );
    }
    assert.equal(entry.reviewed, true, `${staleToken} must be reviewed before closeout`);
    assert.match(entry.resolution, /^(renamed|removed|retained-in-allowlist)$/);
  }
  return errors;
}

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
      "or add a narrow allowlist entry to viberoots/build-tools/tools/dev/stale-names-lint.ts " +
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
      "or add a narrow allowlist entry to viberoots/build-tools/tools/dev/stale-names-lint.ts " +
      "(ALLOWED_PATHS / PLAN_NUMBER_SKIP_PATHS / ALLOWED_PREFIXES) with a reviewed reason.",
  );
});

test("temporary rename inventory review rules reject conflicting duplicate replacements", () => {
  const errors = validateInventory([
    {
      "stale-token": "deployment-control-plane.pr92.docs.test.ts",
      replacement: "deployment-control-plane.admission-docs.test.ts",
      "mechanical-replacement-safe": false,
      reviewed: true,
      resolution: "renamed",
    },
    {
      "stale-token": "deployment-control-plane.pr92.docs.test.ts",
      replacement: "deployment-control-plane.operator-docs.test.ts",
      "mechanical-replacement-safe": false,
      reviewed: true,
      resolution: "renamed",
    },
  ]);
  assert.deepEqual(errors, [
    "deployment-control-plane.pr92.docs.test.ts has conflicting replacements: deployment-control-plane.admission-docs.test.ts vs deployment-control-plane.operator-docs.test.ts",
  ]);
});

test("temporary rename inventory review rules accept matching duplicate replacements", () => {
  const errors = validateInventory([
    {
      "stale-token": "deployment-service.pr88.docs.test.ts",
      replacement: "deployment-service.operator-docs.test.ts",
      "mechanical-replacement-safe": false,
      reviewed: true,
      resolution: "renamed",
    },
    {
      "stale-token": "deployment-service.pr88.docs.test.ts",
      replacement: "deployment-service.operator-docs.test.ts",
      "mechanical-replacement-safe": false,
      reviewed: true,
      resolution: "renamed",
    },
  ]);
  assert.deepEqual(errors, []);
});

test("temporary rename inventory review rules reject blind contextual replacements", () => {
  assert.throws(
    () =>
      validateInventory([
        {
          "stale-token": "legacyDeploymentManifest",
          replacement: "deploymentManifest",
          "mechanical-replacement-safe": true,
          reviewed: true,
          resolution: "renamed",
        },
      ]),
    /context-sensitive/,
  );
});
