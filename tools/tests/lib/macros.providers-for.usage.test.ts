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
  const files = ["go/defs.bzl", "cpp/defs.bzl", "node/defs.bzl", "python/defs.bzl"];
  for (const f of files) {
    const txt = await read(f);
    // Must use realize_provider_edges() helper
    assert(
      txt.includes("realize_provider_edges("),
      `${f} did not call realize_provider_edges(...) as expected`,
    );
    // Should not embed provider FQ labels directly (except allowed load)
    const lines = txt.split(/\r?\n/).filter((l) => l.includes("//third_party/providers:"));
    const offenders = lines.filter(
      (l) =>
        !l.includes('load("//third_party/providers:auto_map.bzl"') &&
        // Allow filtering checks that explicitly avoid wiring provider deps.
        !l.includes('.startswith("//third_party/providers:")'),
    );
    assert(
      offenders.length === 0,
      `${f} contains direct provider references outside auto_map load:\n${offenders.join("\n")}`,
    );
  }
});
