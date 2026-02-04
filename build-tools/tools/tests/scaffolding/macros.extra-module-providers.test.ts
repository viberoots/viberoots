#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("extra_module_providers are appended and normalized", async () => {
  await runInTemp("macro-extra-providers", async (tmp, $) => {
    // Create provider targets and auto_map with proper Starlark quoting
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<\'EOF'
genrule(name="mod_auto", out="mod_auto.stamp", cmd=": > $OUT", visibility=["PUBLIC"])
genrule(name="mod_extra", out="mod_extra.stamp", cmd=": > $OUT", visibility=["PUBLIC"]) 
genrule(name="dup", out="dup.stamp", cmd=": > $OUT", visibility=["PUBLIC"]) 
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<\'EOF'
MODULE_PROVIDERS = {
  "//tmp:lib": ["//third_party/providers:mod_auto"],
}
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p tmp && cat > tmp/TARGETS <<\'EOF' && cat tmp/TARGETS
load("//build-tools/go:defs.bzl", "nix_go_library")

# localprov need not be a go_library; allow any target
genrule(name="localprov", cmd="echo ok > $OUT", out="localprov.stamp")

nix_go_library(
    name = "lib",
    srcs = [],
    deps = [],
    extra_module_providers = ["//third_party/providers:mod_extra", ":localprov"],
)
EOF'`;
    // Probe Buck; now require success instead of skipping
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms prelude//platforms:default "deps(//tmp:lib)" --json --output-attribute name`;
    if (probe.exitCode !== 0) {
      console.error("buck2 cquery failed; prelude or config missing");
      process.exit(2);
    }
    const out = String(probe.stdout || "");
    // Buck2 JSON shape can vary; perform substring checks for robustness
    if (!out.includes("//third_party/providers:mod_auto")) {
      console.error("expected auto provider present");
      process.exit(2);
    }
    if (!out.includes("//third_party/providers:mod_extra")) {
      console.error("expected extra provider present");
      process.exit(2);
    }
    if (!out.includes("//tmp:localprov")) {
      console.error("expected normalized relative provider present");
      process.exit(2);
    }
  });
});

test("dedup keeps first occurrence across deps and extra_module_providers", async () => {
  await runInTemp("macro-extra-providers-dedup", async (tmp, $) => {
    // Provider targets
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<\'EOF'
genrule(name="dup", out="dup.stamp", cmd=": > $OUT", visibility=["PUBLIC"]) 
EOF'`;
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<\'EOF'
MODULE_PROVIDERS = {}
EOF'`;
    await $({ cwd: tmp })`bash --noprofile --norc -c 'mkdir -p tmp && cat > tmp/TARGETS <<\'EOF'
load("//build-tools/go:defs.bzl", "nix_go_library")

nix_go_library(
    name = "lib",
    srcs = [],
    deps = ["//third_party/providers:dup"],
    extra_module_providers = ["//third_party/providers:dup"],
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
      console.error("buck2 cquery failed; prelude or config missing");
      process.exit(2);
    }
    const out = String(probe.stdout || "");
    const count = (out.match(/\/\/third_party\/providers:dup/g) || []).length;
    if (count !== 1) {
      console.error("expected exactly one instance of duplicate provider, got", count);
      process.exit(2);
    }
  });
});
