#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { isSupportedImporterLabel } from "../../lib/importers";

test("isSupportedImporterLabel matches '.', apps/*, libs/* only", () => {
  assert.equal(isSupportedImporterLabel("."), true);
  assert.equal(isSupportedImporterLabel("apps/web"), true);
  assert.equal(isSupportedImporterLabel("libs/core"), true);

  assert.equal(isSupportedImporterLabel("third_party"), false);
  assert.equal(isSupportedImporterLabel("third_party/pnpm-lock.yaml"), false);
  assert.equal(isSupportedImporterLabel("packages/web"), false);
});
