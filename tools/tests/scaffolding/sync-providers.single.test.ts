#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerNameForModuleKey } from "../../lib/providers";
import { runInTemp } from "../lib/test-helpers";
import { ensurePatch } from "../lib/fixtures/go";

test("sync-providers: single patch emits one go_module_patch with stable provider name", async () => {
  await runInTemp("sync-single", async (tmp, $) => {
    const p = await ensurePatch(tmp, "golang.org/x/net", "v0.24.0");
    await $`node tools/buck/sync-providers.ts --out third_party/providers/TARGETS.auto`;
    const txt = await fsp.readFile(
      path.join(tmp, "third_party", "providers", "TARGETS.auto"),
      "utf8",
    );
    const provider = providerNameForModuleKey("golang.org/x/net", "v0.24.0");
    if (!txt.includes(`name = "${provider}"`)) {
      console.error("provider name missing");
      process.exit(2);
    }
    if (!txt.includes('module_key = "golang.org/x/net@v0.24.0"')) {
      console.error("module_key missing or wrong");
      process.exit(2);
    }
    const file = path.basename(p);
    if (!txt.includes(`patch_path = "patches/go/${file}"`)) {
      console.error("patch_path missing or wrong");
      process.exit(2);
    }
    const before = txt;
    await $`node tools/buck/sync-providers.ts --out third_party/providers/TARGETS.auto`;
    const after = await fsp.readFile(
      path.join(tmp, "third_party", "providers", "TARGETS.auto"),
      "utf8",
    );
    if (before !== after) {
      console.error("file changed on second run (should be no-op)");
      process.exit(2);
    }
  });
});
