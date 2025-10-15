#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { providerNameForImporter } from "../../lib/providers";

test("providerNameForImporter produces consistent, deterministic names", async () => {
  const cases = [
    { lf: "apps/web/pnpm-lock.yaml", imp: "apps/web", expectPrefix: "lf_" },
    { lf: "libs/utils/pnpm-lock.yaml", imp: "libs/utils", expectPrefix: "lf_" },
    { lf: "pnpm-lock.yaml", imp: ".", expectPrefix: "lf_" },
    { lf: "apps/api/pnpm-lock.yaml", imp: "apps/api", expectPrefix: "lf_" },
  ];

  for (const c of cases) {
    const name = providerNameForImporter(c.lf, c.imp);

    // Check prefix
    if (!name.startsWith(c.expectPrefix)) {
      console.error(`Expected ${c.expectPrefix} prefix for ${c.lf}#${c.imp}, got: ${name}`);
      process.exit(2);
    }

    // Check hash length (should have 12-char hash after prefix)
    const parts = name.split("_");
    if (parts.length < 2) {
      console.error(`Expected at least 2 parts in provider name, got: ${name}`);
      process.exit(2);
    }
    const hash = parts[1];
    if (hash.length !== 12) {
      console.error(`Expected 12-char hash, got ${hash.length} chars: ${hash}`);
      process.exit(2);
    }

    // Check determinism: same input produces same output
    const name2 = providerNameForImporter(c.lf, c.imp);
    if (name !== name2) {
      console.error(`Non-deterministic naming for ${c.lf}#${c.imp}: ${name} vs ${name2}`);
      process.exit(2);
    }
  }

  // Verify different inputs produce different names
  const name1 = providerNameForImporter("apps/web/pnpm-lock.yaml", "apps/web");
  const name2 = providerNameForImporter("apps/api/pnpm-lock.yaml", "apps/api");
  if (name1 === name2) {
    console.error("Different lockfiles produced same provider name");
    process.exit(2);
  }
});
