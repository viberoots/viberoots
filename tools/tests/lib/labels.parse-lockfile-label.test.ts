#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLockfileLabel, isImporterScopedLockfileLabel } from "../../lib/labels";

test("parseLockfileLabel: root importer '.'", () => {
  const s = "lockfile:pnpm-lock.yaml#.";
  const parsed = parseLockfileLabel(s);
  assert.ok(parsed, "should parse");
  assert.equal(parsed!.lockfile, "pnpm-lock.yaml");
  assert.equal(parsed!.importer, ".");
  assert.equal(isImporterScopedLockfileLabel(s), true);
});

test("parseLockfileLabel: nested importer path", () => {
  const s = "lockfile:apps/web/pnpm-lock.yaml#apps/web";
  const parsed = parseLockfileLabel(s);
  assert.ok(parsed, "should parse");
  assert.equal(parsed!.lockfile, "apps/web/pnpm-lock.yaml");
  assert.equal(parsed!.importer, "apps/web");
  assert.equal(isImporterScopedLockfileLabel(s), true);
});

test("parseLockfileLabel: strips leading './' on path", () => {
  const s = "lockfile:./apps/web/pnpm-lock.yaml#apps/web";
  const parsed = parseLockfileLabel(s);
  assert.ok(parsed, "should parse");
  assert.equal(parsed!.lockfile, "apps/web/pnpm-lock.yaml");
  assert.equal(parsed!.importer, "apps/web");
});

test("parseLockfileLabel: rejects malformed labels", () => {
  const bad = [
    "lockfile:apps/web/pnpm-lock.yaml", // missing importer
    "lockfile:#apps/web", // missing path
    "lockfile:apps/web/pnpm-lock.yaml#", // missing importer
    "lockfile:#", // empty parts
    "lockfile:", // empty
    "lockfile", // not a proper prefix form
    "", // empty string
  ];
  for (const s of bad) {
    assert.equal(parseLockfileLabel(s), null, `expected null for '${s}'`);
    assert.equal(isImporterScopedLockfileLabel(s), false, `expected false for '${s}'`);
  }
});
