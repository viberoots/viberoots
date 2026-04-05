#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { isLikelyEphemeralIsolation } from "../../dev/verify/buck-orphan-cleanup.ts";

test("orphan buck cleanup: matches ephemeral verify/debug/test isolations only", () => {
  const yes = [
    "v-12345-1772235882",
    "verify-nested-12345-deadbeefcafe",
    "verify-nested-deadbeefcafe",
    "debug-cpp-set-final-1772235882",
    "targeted-scaff-1772219350",
    "parity_19426_1772253747273__build_tools_tools_tests_cpp_sanitize_case1",
    "sanitize_19428",
    "importer_strings_19427",
  ];
  const no = [
    "",
    "v2",
    "exporter-shared-1a82e8dd60",
    "devbuild-shared-1a82e8dd60",
    "bucknix-fresh",
    "debug-manual-no-timestamp",
  ];
  for (const iso of yes) assert.equal(isLikelyEphemeralIsolation(iso), true, iso);
  for (const iso of no) assert.equal(isLikelyEphemeralIsolation(iso), false, iso);
});
