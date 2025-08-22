#!/usr/bin/env zx-wrapper
import { mktemp, rsyncRepoTo } from "./lib/test-helpers.ts";
import * as fsp from "node:fs/promises";

async function main() {
  const tmp = await mktemp("buck2-all-tests-");
  try {
    await rsyncRepoTo(tmp);
    const result = await $({ cwd: tmp, stdio: 'pipe' })`buck2 test //...`;
    const out = String(result.stdout) + String(result.stderr || "");
    if (/Build failure|error:/i.test(out)) {
      console.error(out);
      process.exit(2);
    }
    // Expect tests to run; require at least one test target to be reported
    if (!/Tests finished:/i.test(out)) {
      console.error("buck2 output did not include test summary. Got:\n" + out);
      process.exit(3);
    }
    console.log("OK — buck2 ran tests using TARGETS in temp repo");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(e => { console.error(e); process.exit(1); });
