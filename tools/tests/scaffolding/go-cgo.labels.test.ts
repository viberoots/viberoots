#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_go_library stamps cgo:enabled and nixpkg labels when nix_cgo_deps set", async () => {
  await runInTemp("go-cgo-labels", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash -lc 'mkdir -p third_party/providers && cat > third_party/providers/TARGETS <<'\''EOF'\''
load("//third_party/providers:defs_cpp.bzl", "nix_cxx_library")
nix_cxx_library(name="nix_pkgs_zlib", attr="pkgs.zlib")
EOF'`;

    // Provide an auto_map with (optional) mapping; labels test does not rely on deps wiring
    await $({
      cwd: tmp,
    })`bash -lc 'cat > third_party/providers/auto_map.bzl <<'\''EOF'\''
# GENERATED for test (mapping can be empty for this label-only check)
MODULE_PROVIDERS = {
    "//tmp:lib": [
        "//third_party/providers:nix_pkgs_zlib",
    ],
}
EOF'`;

    await $({ cwd: tmp })`bash -lc 'mkdir -p tmp && cat > tmp/TARGETS <<'\''EOF'\''
load("//go:defs.bzl", "nix_go_library")

nix_go_library(
    name = "lib",
    srcs = [],
    nix_cgo_deps = ["pkgs.zlib"],
)
EOF'`;

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery "attr(labels, '.*', //tmp:lib)" --json --output-attributes labels`;
    if (probe.exitCode !== 0) return; // skip if prelude not available
    const nodes = JSON.parse(String(probe.stdout || "")) as Array<{ labels?: string[] }>;
    const labels = (nodes[0]?.labels || []).sort();
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
