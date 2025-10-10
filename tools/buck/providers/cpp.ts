#!/usr/bin/env zx-wrapper
import fs from "fs-extra";

export async function syncCppProviders(opts?: { outFile?: string }) {
  const OUT = opts?.outFile || "third_party/providers/TARGETS.cpp.auto";
  const header = [
    "# GENERATED FILE — DO NOT EDIT.",
    "# C++ overlays/patches are tracked via Nix evaluation and repo-root glue.",
    "# No additional provider rules are needed here.",
    "",
  ].join("\n");
  await fs.outputFile(OUT, header, "utf8");
}
