#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("Go macros must not use removed mutating planner-visible stub helper", async () => {
  const file = viberootsSourcePath("viberoots/build-tools/go/defs.bzl");
  const txt = await fsp.readFile(file, "utf8");
  assert(
    !txt.includes("wire_package_local_planner_visible_stub_legacy_mutating("),
    `${file} must not call wire_package_local_planner_visible_stub_legacy_mutating(...)`,
  );
});
