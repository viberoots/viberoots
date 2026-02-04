#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("build-tools/lang/wasm_package_local_wiring.bzl does not call mutating package-local planner-visible stub helper", async () => {
  const txt = await fsp.readFile("build-tools/lang/wasm_package_local_wiring.bzl", "utf8");
  assert(
    !txt.includes("wire_package_local_planner_visible_stub_legacy_mutating("),
    "build-tools/lang/wasm_package_local_wiring.bzl must not call wire_package_local_planner_visible_stub_legacy_mutating(...)",
  );
});
