#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { providersHeaderFor, providersLoadFor } from "../../lib/providers-headers";

test("providers-headers: node header snapshot", () => {
  const load = providersLoadFor({ lang: "node", rule: "node_importer_deps" });
  const header = providersHeaderFor({ lang: "node", load, rule: "node_importer_deps" });
  const expected =
    "# GENERATED FILE — DO NOT EDIT.\n" +
    'load("@workspace_providers//:defs_node.bzl", "node_importer_deps")\n' +
    "\n";
  assert.equal(header, expected);
});
