#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { getImporterRootsContract } from "../../lib/importer-roots.ts";
import { isSupportedImporterLabel } from "../../lib/importers";

test("isSupportedImporterLabel matches the importer-roots contract", () => {
  const { allowDotImporter, workspaceRoots } = getImporterRootsContract();
  if (allowDotImporter) {
    assert.equal(isSupportedImporterLabel("."), true);
  } else {
    assert.equal(isSupportedImporterLabel("."), false);
  }
  for (const root of workspaceRoots) {
    assert.equal(isSupportedImporterLabel(`${root}/web`), true);
    assert.equal(isSupportedImporterLabel(`./${root}/web`), true);
  }

  assert.equal(isSupportedImporterLabel("third_party"), false);
  assert.equal(isSupportedImporterLabel("third_party/pnpm-lock.yaml"), false);
  assert.equal(isSupportedImporterLabel("packages/web"), false);
  for (const root of workspaceRoots) {
    assert.equal(isSupportedImporterLabel(`${root}/web/sub`), false);
  }
  assert.equal(isSupportedImporterLabel("../apps/web"), false);
});
