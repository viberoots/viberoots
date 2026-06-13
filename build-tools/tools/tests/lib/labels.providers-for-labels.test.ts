#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { providersForLabels } from "../../lib/labels";

test("providersForLabels parses lockfile/nixpkg labels (module labels ignored)", async () => {
  const labels = [
    "module:github.com/sirupsen/logrus@v1.9.0",
    "module:GOLANG.ORG/X/NET@V0.24.0", // case-insensitive handling
    "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
    "nixpkg:pkgs.zlib",
    "nixpkg:gtest", // alias to pkgs.googletest
  ];
  const out = providersForLabels(labels);
  // should be fully qualified provider labels
  for (const p of out) {
    if (!p.startsWith("workspace_providers//:")) {
      console.error("bad provider fq label:", p);
      process.exit(2);
    }
  }
  // spot-check a few expected patterns (hashes are content-derived; only check prefixes)
  const has = (substr: string) => out.some((p) => p.includes(substr));
  if (!has(":lf_")) {
    console.error("expected a lockfile provider", out);
    process.exit(2);
  }
  if (!has(":nix_pkgs_")) {
    console.error("expected a nixpkg provider", out);
    process.exit(2);
  }
});
