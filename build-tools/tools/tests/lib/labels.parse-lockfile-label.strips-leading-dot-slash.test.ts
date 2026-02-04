#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLockfileLabel } from "../../lib/labels";

test("parseLockfileLabel: strips leading './' on path", () => {
  const s = "lockfile:./apps/web/pnpm-lock.yaml#apps/web";
  const parsed = parseLockfileLabel(s);
  assert.ok(parsed, "should parse");
  assert.equal(parsed!.lockfile, "apps/web/pnpm-lock.yaml");
  assert.equal(parsed!.importer, "apps/web");
});

test("parseLockfileLabel: strips repeated leading './' segments on path", () => {
  const s = "lockfile:././apps/web/pnpm-lock.yaml#apps/web";
  const parsed = parseLockfileLabel(s);
  assert.ok(parsed, "should parse");
  assert.equal(parsed!.lockfile, "apps/web/pnpm-lock.yaml");
  assert.equal(parsed!.importer, "apps/web");
});
