#!/usr/bin/env zx-wrapper
import path from "node:path";
import * as fsp from "node:fs/promises";
import { rsyncRepoTo, mktemp, exists } from "./lib/test-helpers";

async function main() {
  const tmp = await mktemp("scaf-smoke-");
  await rsyncRepoTo(tmp);
  try {
    const name = "demo-lib";
    const absDest = path.join(tmp, "libs", name);
    await $({ cwd: tmp })`scaf new go lib ${name}`;
    const readme = path.join(absDest, "README.md");
    if (!(await exists(readme))) {
      console.error("README.md missing in scaffold; listing dest and parent:");
      try { await $`ls -la ${absDest}`; } catch {}
      try { await $`ls -la ${path.dirname(absDest)}`; } catch {}
      process.exit(2);
    }
    const content = await fsp.readFile(readme, "utf8");
    if (!content.includes(`# ${name} (Go library)`)) {
      console.error("README.md content did not render expected title:");
      console.error(content);
      process.exit(2);
    }
    console.log("OK — scaffolding smoke test passed:", path.relative(tmp, absDest));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(e => { console.error(e); process.exit(1); });
