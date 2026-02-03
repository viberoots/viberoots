#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { providersHeaderFor, providersLoadFor } from "../../lib/providers-headers";

test("providers-headers: python header snapshot", () => {
  const load = providersLoadFor({ lang: "python", rule: "python_importer_deps" });
  const header = providersHeaderFor({ lang: "python", load, rule: "python_importer_deps" });
  const expected =
    "# GENERATED FILE — DO NOT EDIT.\n" +
    'load("//third_party/providers:defs_python.bzl", "python_importer_deps")\n' +
    "\n";
  assert.equal(header, expected);
});
