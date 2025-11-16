#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { effectiveSetForImporter } from "../../lib/pnpm-lock.ts";
import type { PNPMDoc } from "../../lib/pnpm-lock.ts";

test("pnpm-lock: effective set includes resolved peers", async () => {
  const doc: PNPMDoc = {
    importers: {
      "apps/web": {
        dependencies: {
          "react-dom": "18.2.0",
        },
      },
    },
    packages: {
      "/react/18.2.0": {
        dependencies: {},
        peerDependencies: {},
      },
      "/react-dom/18.2.0": {
        // react-dom declares a peer on react, and has it resolved in dependencies
        peerDependencies: { react: "^18" },
        dependencies: { react: "18.2.0" },
      },
    },
  };

  const eff = effectiveSetForImporter(doc, "apps/web");
  const got = Array.from(eff).sort();
  const expected = ["react@18.2.0", "react-dom@18.2.0"].sort();
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    console.error("expected", expected, "got", got);
    process.exit(2);
  }
});
