#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_cxx_library genrule produces a stamp", async () => {
  await runInTemp("providers-defs-cpp-build", async (tmp, $) => {
    // Wire a tiny TARGETS with a provider stamp and build it
    await $`bash -lc ${`set -euo pipefail
      mkdir -p third_party/providers
      cat > third_party/providers/TARGETS <<'EOF'
      load("//third_party/providers:defs_cpp.bzl", "nix_cxx_library")
      nix_cxx_library(name = "zlib_provider", attr = "pkgs.zlib")
      EOF
      buck2 build //third_party/providers:zlib_provider
    `}`;
  });
});
