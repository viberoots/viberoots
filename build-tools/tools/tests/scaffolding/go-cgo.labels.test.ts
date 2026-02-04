#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_go_library stamps cgo:enabled and nixpkg labels when nixpkg_deps set", async () => {
  await runInTemp("go-cgo-labels", async (tmp, $) => {
    // Provide an auto_map mapping file; this label-only test must not depend on provider edges.
    // (If MODULE_PROVIDERS maps this target to a provider, Buck package visibility rules apply
    // and the test becomes a provider-wiring test instead of a label-stamping test.)
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
# GENERATED for test (mapping can be empty for this label-only check)
MODULE_PROVIDERS = {
}
EOF'`;

    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p tmp && cat > tmp/TARGETS <<'\''EOF'\''
load("//build-tools/go:defs.bzl", "nix_go_library")

nix_go_library(
    name = "lib",
    srcs = [],
    nixpkg_deps = ["pkgs.zlib"],
)
EOF'`;

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir cgo_labels cquery --target-platforms //:no_cgo --json --output-attribute labels //tmp:lib`;
    if (probe.exitCode !== 0) {
      console.error(String(probe.stderr || probe.stdout || ""));
      process.exit(2);
    }
    const parsed = JSON.parse(String(probe.stdout || "")) as unknown;
    const values = Array.isArray(parsed)
      ? (parsed as Array<{ labels?: string[] }>)
      : (Object.values(parsed as Record<string, { labels?: string[] }>) as Array<{
          labels?: string[];
        }>);
    const labels = (values[0]?.labels || []).sort();
    if (!labels.includes("cgo:enabled")) {
      console.error("expected cgo:enabled label");
      process.exit(2);
    }
    if (!labels.includes("nixpkg:pkgs.zlib")) {
      console.error("expected nixpkg:pkgs.zlib label");
      process.exit(2);
    }
  });
});
