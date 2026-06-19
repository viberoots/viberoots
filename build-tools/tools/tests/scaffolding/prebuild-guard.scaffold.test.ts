#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard auto-fixes when stale and passes thereafter", async () => {
  const prevRoots = process.env.TEST_RSYNC_ROOTS;
  if (!prevRoots) {
    process.env.TEST_RSYNC_ROOTS = "viberoots/build-tools toolchains third_party/providers";
  }
  try {
    await runInTemp("scaf-prebuild-guard", async (_tmp, _$) => {
      const $ = _$({ stdio: "pipe" });
      // Ensure temp repo defines a local platform that disables CGO and sets it as default
      await $`bash --noprofile --norc -c ${`set -euo pipefail
      test -f flake.lock || printf "{}\n" > flake.lock
      cat > TARGETS <<'EOF'
load("@prelude//:rules.bzl", "export_file")

platform(
    name = "no_cgo",
    constraint_values = [
        "config//go/constraints:cgo_enabled_false",
        "config//go/constraints:asan_false",
        "config//go/constraints:race_false",
    ],
    visibility = ["PUBLIC"],
)

export_file(
    name = "flake.lock",
    src = "flake.lock",
    visibility = ["PUBLIC"],
)
EOF
      awk '1; NR==1{print ""} END{print "[build]"; print "prelude = prelude"; print "default_platform = //:no_cgo"; print "user_platform = //:no_cgo"; print "target_platforms = //:no_cgo"}' .buckconfig > .buckconfig.new || cp .buckconfig .buckconfig.new
      mv .buckconfig.new .buckconfig
    `}`;
      // Rely on runInTemp's default .buckconfig (no_cgo) instead of writing our own
      await $`scaf new go lib demo-lib --yes --skip-lockfile-gen`;
      // Guard should auto-fix glue if stale and succeed
      await $`env PREBUILD_GUARD_SKEW_MS=5000 node viberoots/build-tools/tools/buck/prebuild-guard.ts`;
      // Validate Buck can resolve the scaffolded target without a full build.
      await $`env CGO_ENABLED=0 buck2 targets --target-platforms //:no_cgo //projects/libs/demo-lib:demo-lib`;
      await $`env PREBUILD_GUARD_SKEW_MS=5000 node viberoots/build-tools/tools/buck/prebuild-guard.ts`;
    });
  } finally {
    if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
    else process.env.TEST_RSYNC_ROOTS = prevRoots;
  }
});
