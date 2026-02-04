#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("Go macros must not use legacy mutating planner-visible stub helper (enforced abstraction boundary)", async () => {
  const file = "go/defs.bzl";
  const txt = await fsp.readFile(file, "utf8");
  assert(
    !txt.includes("wire_package_local_planner_visible_stub_legacy_mutating("),
    `${file} must not call wire_package_local_planner_visible_stub_legacy_mutating(...)`,
  );
});
