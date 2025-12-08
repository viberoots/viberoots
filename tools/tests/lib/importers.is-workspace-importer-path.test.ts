#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { isWorkspaceImporterPath } from "../../lib/importers.ts";

test("isWorkspaceImporterPath matches apps/* and libs/* only", async () => {
  // True cases
  assert.equal(isWorkspaceImporterPath("apps/web"), true);
  assert.equal(isWorkspaceImporterPath("libs/api"), true);
  assert.equal(isWorkspaceImporterPath("apps/web/subdir".replace(/\/subdir$/, "")), true);
  // False cases
  assert.equal(isWorkspaceImporterPath("."), false);
  assert.equal(isWorkspaceImporterPath("third_party/foo"), false);
  assert.equal(isWorkspaceImporterPath("tools"), false);
  assert.equal(isWorkspaceImporterPath("random"), false);
});
