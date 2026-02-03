#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("package-local language macros must not bypass prepare_language_wiring()", async () => {
  const offenders: Array<{ file: string; reason: string }> = [];
  const files = ["go/defs.bzl", "cpp/defs.bzl"];
  for (const file of files) {
    const txt = await fsp.readFile(file, "utf8");
    if (txt.includes('load("//lang:package_local_wiring.bzl"')) {
      offenders.push({
        file,
        reason:
          "must not load //lang:package_local_wiring.bzl directly; use //lang:defs_common.bzl:prepare_language_wiring(...) instead",
      });
    }
    if (txt.includes('load("//lang/internal:package_local_wiring.bzl"')) {
      offenders.push({
        file,
        reason:
          "must not load internal package-local wiring; use //lang:defs_common.bzl:prepare_language_wiring(...) instead",
      });
    }
    if (txt.includes("include_package_local_patches(")) {
      offenders.push({
        file,
        reason:
          "must not call include_package_local_patches directly; use //lang:defs_common.bzl:prepare_language_wiring(...) instead",
      });
    }
    if (!txt.includes("prepare_language_wiring(")) {
      offenders.push({
        file,
        reason: "expected to use prepare_language_wiring(...) for package-local wiring",
      });
    }
    if (txt.includes("prepare_package_local_wiring_legacy_mutating(")) {
      offenders.push({
        file,
        reason:
          "must not call prepare_package_local_wiring_legacy_mutating(...); mutating helpers are legacy-only",
      });
    }
    if (txt.includes("prepare_package_local_wiring_v2(")) {
      offenders.push({
        file,
        reason:
          "must not call prepare_package_local_wiring_v2(...); versioned helper names are removed",
      });
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `package-local wiring bypass detected:\n${offenders.map((o) => `- ${o.file}: ${o.reason}`).join("\n")}`,
  );
});
