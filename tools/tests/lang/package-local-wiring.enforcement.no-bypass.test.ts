#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("package-local language macros must not bypass prepare_package_local_wiring()", async () => {
  const offenders: Array<{ file: string; reason: string }> = [];
  const files = ["go/defs.bzl", "cpp/defs.bzl"];
  for (const file of files) {
    const txt = await fsp.readFile(file, "utf8");
    if (txt.includes("include_package_local_patches(")) {
      offenders.push({
        file,
        reason:
          "must not call include_package_local_patches directly; use //lang:defs_common.bzl:prepare_package_local_wiring_v2(...) instead",
      });
    }
    if (!txt.includes("prepare_package_local_wiring_v2(")) {
      offenders.push({
        file,
        reason: "expected to use prepare_package_local_wiring_v2(...) for package-local wiring",
      });
    }
    if (txt.includes("prepare_package_local_wiring(")) {
      offenders.push({
        file,
        reason:
          "must not call prepare_package_local_wiring(...); v2 wiring is the macro-authoring default",
      });
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `package-local wiring bypass detected:\n${offenders.map((o) => `- ${o.file}: ${o.reason}`).join("\n")}`,
  );
});
