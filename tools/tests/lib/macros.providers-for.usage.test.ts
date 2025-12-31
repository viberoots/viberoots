#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";

async function read(file: string) {
  return await fsp.readFile(file, "utf8");
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

test("macros use realize_provider_edges() and avoid direct provider labels", async () => {
  const files = [
    "go/defs.bzl",
    "cpp/defs.bzl",
    "node/defs_core.bzl",
    "python/defs.bzl",
    "rust/defs.bzl",
  ];
  for (const f of files) {
    const txt = await read(f);
    assert(
      !txt.includes('load("//third_party/providers:auto_map.bzl"'),
      `${f} must not load //third_party/providers:auto_map.bzl directly; use //lang:auto_map.bzl`,
    );
    assert(
      txt.includes('load("//lang:auto_map.bzl"'),
      `${f} must load MODULE_PROVIDERS via //lang:auto_map.bzl`,
    );
    // Must use shared provider-edge wiring helpers (direct, via importer wiring, or via planner-visible stub wiring)
    assert(
      txt.includes("realize_provider_edges(") ||
        txt.includes("merge_provider_edges(") ||
        txt.includes("prepare_package_local_wiring(") ||
        txt.includes("prepare_importer_genrule_kwargs(") ||
        txt.includes("prepare_importer_non_genrule_wiring(") ||
        txt.includes("prepare_importer_non_genrule_nix_calling_wiring(") ||
        txt.includes("prepare_importer_srcsless_rule_wiring(") ||
        txt.includes("wire_planner_visible_inputs(") ||
        txt.includes("wire_planner_visible_stub(") ||
        txt.includes("wire_package_local_planner_visible_stub("),
      `${f} did not use provider-edge wiring helpers as expected`,
    );
    // Should not embed provider FQ labels directly (except allowed load)
    const lines = txt.split(/\r?\n/).filter((l) => l.includes("//third_party/providers:"));
    const offenders = lines.filter(
      (l) =>
        !l.includes('load("//lang:auto_map.bzl"') &&
        // Allow filtering checks that explicitly avoid wiring provider deps.
        !l.includes('.startswith("//third_party/providers:")'),
    );
    assert(
      offenders.length === 0,
      `${f} contains direct provider references outside auto_map load:\n${offenders.join("\n")}`,
    );
  }
});
