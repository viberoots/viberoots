#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard auto-fixes when stale and passes thereafter", async () => {
  await runInTemp("scaf-prebuild-guard", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    // Ensure temp repo defines a local platform that disables CGO and sets it as default
    await $`bash -lc ${`set -euo pipefail
      cat > TARGETS <<'EOF'
platform(
    name = "no_cgo",
    constraint_values = [
        "config//go/constraints:cgo_enabled_false",
        "config//go/constraints:asan_false",
        "config//go/constraints:race_false",
    ],
    visibility = ["PUBLIC"],
)
EOF
      awk '1; NR==1{print ""} END{print "[build]"; print "prelude = prelude"; print "default_platform = //:no_cgo"; print "user_platform = //:no_cgo"; print "target_platforms = //:no_cgo"}' .buckconfig > .buckconfig.new || cp .buckconfig .buckconfig.new
      mv .buckconfig.new .buckconfig
    `}`;
    // Initialize git so git-based checks in dev-build don't error out in temp repos
    await $`git init`;
    // Rely on runInTemp's default .buckconfig (no_cgo) instead of writing our own
    await $`scaf new go lib demo-lib --yes`;
    // Guard should auto-fix glue if stale and succeed
    await $`env PREBUILD_GUARD_SKEW_MS=5000 node tools/buck/prebuild-guard.ts`;
    // Build via Buck with an explicit target platform to avoid unspecified-platform selects
    await $`env CGO_ENABLED=0 buck2 build --target-platforms //:no_cgo //...`;
    await $`env PREBUILD_GUARD_SKEW_MS=5000 node tools/buck/prebuild-guard.ts`;
  });
});
