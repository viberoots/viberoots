#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("node/defs_core.bzl must use non-mutating importer wiring helpers", async () => {
  const file = "node/defs_core.bzl";
  const txt = await fsp.readFile(file, "utf8");

  assert(
    txt.includes("prepare_importer_genrule_kwargs("),
    `${file} must call prepare_importer_genrule_kwargs(...) for nix_node_gen`,
  );
  assert(
    txt.includes("prepare_importer_non_genrule_nix_calling_wiring("),
    `${file} must call prepare_importer_non_genrule_nix_calling_wiring(...) for nix_node_test`,
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
