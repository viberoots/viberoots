#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { getImporterRootsContract } from "../../lib/importer-roots";
import { isWorkspaceImporterPath } from "../../lib/importers";

test("isWorkspaceImporterPath matches the importer-roots contract workspace roots only", async () => {
  const { workspaceRoots } = getImporterRootsContract();
  for (const root of workspaceRoots) {
    assert.equal(isWorkspaceImporterPath(`${root}/web`), true);
  }
  // False cases
  assert.equal(isWorkspaceImporterPath("."), false);
  assert.equal(isWorkspaceImporterPath("third_party/foo"), false);
  assert.equal(isWorkspaceImporterPath("tools"), false);
  assert.equal(isWorkspaceImporterPath("random"), false);
  for (const root of workspaceRoots) {
    assert.equal(isWorkspaceImporterPath(`${root}/web/subdir`), false);
  }
});
