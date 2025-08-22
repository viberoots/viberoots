#!/usr/bin/env zx-wrapper
import { mktemp } from "./lib/test-helpers.ts";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

async function main() {
  const tmp = await mktemp("buck2-targets-");
  try {
    // Create minimal repo skeleton: .buckconfig + empty TARGETS
    const buckconfig = `[repositories]\nroot = .\n\n[buildfile]\nname = TARGETS\n`;
    await fsp.writeFile(path.join(tmp, ".buckconfig"), buckconfig, "utf8");
    await fsp.writeFile(path.join(tmp, "TARGETS"), "# empty\n", "utf8");

    const result = await $({ cwd: tmp, stdio: 'pipe' })`buck2 test //...`;
    const out = String(result.stdout) + String(result.stderr || "");

    if (/Build failure|error:/i.test(out)) {
      console.error(out);
      process.exit(2);
    }
    // With empty TARGETS, expect no tests ran but command succeeds
    if (!/NO TESTS RAN/i.test(out)) {
      console.error("Expected 'NO TESTS RAN' in buck2 output. Got:\n" + out);
      process.exit(3);
    }
    console.log("OK — Buck2 recognized TARGETS and ran with no tests in minimal repo");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(e => { console.error(e); process.exit(1); });
