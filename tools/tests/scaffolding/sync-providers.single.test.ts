#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";
import { providerNameForModuleKey } from "../../lib/providers";

test("sync-providers: single patch emits one go_module_patch with stable provider name", async () => {
  await runInTemp("sync-single", async (tmp, $) => {
    const dir = path.join(tmp, "patches", "go");
    await fsp.mkdir(dir, { recursive: true });
    const file = "golang.org__x__net@v0.24.0.patch";
    await fsp.writeFile(path.join(dir, file), "# patch\n", "utf8");
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
