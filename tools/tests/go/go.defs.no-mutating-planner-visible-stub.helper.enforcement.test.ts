#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("Go macros must not use mutating wire_package_local_planner_visible_stub (enforced abstraction boundary)", async () => {
  const file = "go/defs.bzl";
  const txt = await fsp.readFile(file, "utf8");
  assert(
    !txt.includes("wire_package_local_planner_visible_stub("),
    `${file} must not call wire_package_local_planner_visible_stub(...); use wire_package_local_planner_visible_stub_v2(...)`,
  );
});
