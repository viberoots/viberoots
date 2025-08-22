#!/usr/bin/env zx-wrapper
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

async function rsyncRepoTo(tmp: string) {
  await $`bash -lc 'rsync -a --exclude "buck-out" --exclude "node_modules" --exclude ".git" ./ ${tmp}/'`;
}

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scaf-smoke-"));
  await rsyncRepoTo(tmp);
  const cwd = process.cwd();
  try {
    process.chdir(tmp);
    const dest = path.join("libs","demo-lib");
    await $`scaf new go lib demo-lib`;
    if (!(await fs.pathExists(path.join(dest, "README.md")))) {
      console.error("README.md missing in scaffold");
      process.exit(2);
    }
    console.log("OK — scaffolding smoke test passed:", dest);
  } finally {
    process.chdir(cwd);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
