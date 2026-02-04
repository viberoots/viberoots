#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("integration: extra_module_providers works with real prelude when available", async () => {
  await runInTemp("macro-extra-providers-int", async (tmp, $) => {
    // Prepare providers and auto_map
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<\'EOF'
genrule(name="mod_auto", out="mod_auto.stamp", cmd=": > $OUT", visibility=["PUBLIC"]) 
genrule(name="mod_extra", out="mod_extra.stamp", cmd=": > $OUT", visibility=["PUBLIC"]) 
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<\'EOF'
MODULE_PROVIDERS = {
  "//tmp:lib": ["//third_party/providers:mod_auto"],
}
EOF'`;

    // Create a package that uses the real prelude go_* via our repo build-tools/go/defs.bzl
    await $({ cwd: tmp })`bash --noprofile --norc -c 'mkdir -p tmp && cat > tmp/TARGETS <<\'EOF'
load("//build-tools/go:defs.bzl", "nix_go_library")

genrule(name="localprov", cmd=": > $OUT", out="localprov.stamp")

nix_go_library(
    name = "lib",
    srcs = [],
    deps = [],
    extra_module_providers = ["//third_party/providers:mod_extra", ":localprov"],
)
EOF'`;

    // Require success
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms prelude//platforms:default "deps(//tmp:lib)" --json --output-attribute name`;
    if (probe.exitCode !== 0) {
      console.error("buck2 cquery failed; prelude or config missing (integration)");
      process.exit(2);
    }

    const out = String(probe.stdout || "");
    if (!out.includes("//third_party/providers:mod_auto")) {
      console.error("expected auto provider present (integration)");
      process.exit(2);
    }
    if (!out.includes("//third_party/providers:mod_extra")) {
      console.error("expected extra provider present (integration)");
      process.exit(2);
    }
    if (!out.includes("//tmp:localprov")) {
      console.error("expected normalized relative provider present (integration)");
      process.exit(2);
    }
  });
});
