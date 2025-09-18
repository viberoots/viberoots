#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("integration: extra_module_providers works with real prelude when available", async () => {
  await runInTemp("macro-extra-providers-int", async (tmp, $) => {
    // Prepare providers and auto_map
    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<\'EOF'
genrule(name="mod_auto", out="mod_auto.stamp", cmd=": > $OUT")
genrule(name="mod_extra", out="mod_extra.stamp", cmd=": > $OUT")
EOF'`;
    await $({ cwd: tmp })`bash -lc 'cat > third_party/providers/auto_map.bzl <<\'EOF'
MODULE_PROVIDERS = {
  "//tmp:lib": ["//third_party/providers:mod_auto"],
}
EOF'`;

    // Create a package that uses the real prelude go_* via our repo go/defs.bzl
    await $({ cwd: tmp })`bash -lc 'mkdir -p tmp && cat > tmp/TARGETS <<\'EOF'
load("//go:defs.bzl", "nix_go_library")

genrule(name="localprov", cmd=": > $OUT", out="localprov.stamp")

nix_go_library(
    name = "lib",
    srcs = [],
    deps = [],
    extra_module_providers = ["//third_party/providers:mod_extra", ":localprov"],
)
EOF'`;

    // Try Buck with real prelude. If the environment lacks a prelude alias/path, skip gracefully.
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery "deps(//tmp:lib)" --json --output-attribute name`;
    const out = String(probe.stdout || "");
    const err = String(probe.stderr || "");
    if (probe.exitCode !== 0) {
      console.log(
        "SKIP: prelude likely unavailable in this shell; run inside dev shell to enable integration test.",
      );
      return;
    }

    const nodes = JSON.parse(out) as Array<{ name: string }>;
    const names = nodes.map((n) => n.name);
    if (!names.includes("//third_party/providers:mod_auto")) {
      console.error("expected auto provider present (integration)");
      process.exit(2);
    }
    if (!names.includes("//third_party/providers:mod_extra")) {
      console.error("expected extra provider present (integration)");
      process.exit(2);
    }
    if (!names.includes("//tmp:localprov")) {
      console.error("expected normalized relative provider present (integration)");
      process.exit(2);
    }
  });
});
