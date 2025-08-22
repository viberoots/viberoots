#!/usr/bin/env zx-wrapper
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scaf-smoke-"));
  const dest = path.join(tmp, "demo-lib");
  await $`tools/scaffolding/scaf.ts new go lib demo-lib --path=${dest}`;
  if (!(await fs.pathExists(path.join(dest, "README.md")))) {
    console.error("README.md missing in scaffold");
    process.exit(2);
  }
  console.log("OK — scaffolding smoke test passed:", dest);
}

main().catch(e => { console.error(e); process.exit(1); });
