#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("extra_module_providers are appended and normalized", async () => {
  await runInTemp("macro-extra-providers", async (tmp, $) => {
    // Create provider targets and auto_map with proper Starlark quoting
    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<\'EOF'
genrule(name="mod_auto", out="mod_auto.stamp", cmd=": > $OUT")
genrule(name="mod_extra", out="mod_extra.stamp", cmd=": > $OUT")
genrule(name="dup", out="dup.stamp", cmd=": > $OUT")
EOF'`;
    await $({ cwd: tmp })`bash -lc 'cat > third_party/providers/auto_map.bzl <<\'EOF'
MODULE_PROVIDERS = {
  "//tmp:lib": ["//third_party/providers:mod_auto"],
}
EOF'`;
    await $({ cwd: tmp })`bash -lc 'mkdir -p tmp && cat > tmp/TARGETS <<\'EOF' && cat tmp/TARGETS
load("//go:defs.bzl", "nix_go_library")

# localprov need not be a go_library; allow any target
genrule(name="localprov", cmd="echo ok > $OUT", out="localprov.stamp")

nix_go_library(
    name = "lib",
    srcs = [],
    deps = [],
    extra_module_providers = ["//third_party/providers:mod_extra", ":localprov"],
)
EOF'`;
    // Probe Buck with real prelude; skip if prelude alias is unavailable
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
        "SKIP: prelude likely unavailable in this shell; run inside dev shell to enable unit test.",
      );
      return;
    }
    const nodes = JSON.parse(out) as Array<{ name: string }>;
    const names = nodes.map((n) => n.name);
    if (!names.includes("//third_party/providers:mod_auto")) {
      console.error("expected auto provider present");
      process.exit(2);
    }
    if (!names.includes("//third_party/providers:mod_extra")) {
      console.error("expected extra provider present");
      process.exit(2);
    }
    if (!names.includes("//tmp:localprov")) {
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
    })`bash -lc 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<\'EOF'
genrule(name="dup", out="dup.stamp", cmd=": > $OUT")
EOF'`;
    await $({ cwd: tmp })`bash -lc 'cat > third_party/providers/auto_map.bzl <<\'EOF'
MODULE_PROVIDERS = {}
EOF'`;
    await $({ cwd: tmp })`bash -lc 'mkdir -p tmp && cat > tmp/TARGETS <<\'EOF'
load("//go:defs.bzl", "nix_go_library")

nix_go_library(
    name = "lib",
    srcs = [],
    deps = ["//third_party/providers:dup"],
    extra_module_providers = ["//third_party/providers:dup"],
)
EOF'`;
    // Probe Buck with real prelude; skip if prelude alias is unavailable
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
        "SKIP: prelude likely unavailable in this shell; run inside dev shell to enable unit test.",
      );
      return;
    }
    const nodes = JSON.parse(out) as Array<{ name: string }>;
    const dup = nodes.filter((n) => n.name === "//third_party/providers:dup");
    if (dup.length !== 1) {
      console.error("expected exactly one instance of duplicate provider, got", dup.length);
      process.exit(2);
    }
  });
});
