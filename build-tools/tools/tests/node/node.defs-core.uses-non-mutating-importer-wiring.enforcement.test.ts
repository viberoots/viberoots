#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("build-tools/node/defs_core.bzl must use the unified wiring helper", async () => {
  const file = viberootsSourcePath("viberoots/build-tools/node/defs_core.bzl");
  const txt = await fsp.readFile(file, "utf8");

  assert(
    txt.includes("prepare_language_wiring("),
    `${file} must call prepare_language_wiring(...) for importer-scoped wiring`,
  );

  assert(
    !txt.includes("prepare_importer_genrule_kwargs_legacy_mutating("),
    `${file} must not call prepare_importer_genrule_kwargs_legacy_mutating(...)`,
  );
  assert(
    !txt.includes("prepare_importer_non_genrule_wiring_legacy_mutating("),
    `${file} must not call prepare_importer_non_genrule_wiring_legacy_mutating(...)`,
  );
});
