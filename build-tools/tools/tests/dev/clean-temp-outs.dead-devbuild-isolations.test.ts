#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRemoveDeadDevBuildIsolationDir } from "../../dev/clean-temp-outs-lib.ts";

test("clean-temp-outs removes dead one-shot devbuild isolation dirs", () => {
  assert.equal(
    shouldRemoveDeadDevBuildIsolationDir("devbuild-12345", () => false),
    true,
  );
  assert.equal(
    shouldRemoveDeadDevBuildIsolationDir("devbuild-12345-extra", () => false),
    true,
  );
});

test("clean-temp-outs preserves live or shared devbuild isolation dirs", () => {
  assert.equal(
    shouldRemoveDeadDevBuildIsolationDir("devbuild-12345", () => true),
    false,
  );
  assert.equal(
    shouldRemoveDeadDevBuildIsolationDir("devbuild-shared-1a82e8dd60", () => false),
    false,
  );
  assert.equal(
    shouldRemoveDeadDevBuildIsolationDir("bucknix-fresh", () => false),
    false,
  );
});
