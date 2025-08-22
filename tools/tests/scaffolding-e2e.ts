#!/usr/bin/env zx-wrapper
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

async function rsyncRepoTo(tmp: string) {
  await $`bash -lc 'rsync -a --exclude "buck-out" --exclude "node_modules" --exclude ".git" ./ ${tmp}/'`;
}

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scaf-e2e-"));
  await rsyncRepoTo(tmp);
  const cwd = process.cwd();
  try {
    process.chdir(tmp);
    await $`scaf new go lib demo-lib`;
    // Initialize git and commit to satisfy copier update/regen cleanliness checks
    await $`git init`;
    await $`git add -A`;
    await $`git commit -m "init scaffold"`;

    const res = await $({ stdio: 'pipe' })`scaf ls --json`;
    const arr = JSON.parse(res.stdout.trim() || "[]");
    if (!arr.some((r: any) => r.path.endsWith("libs/demo-lib"))) {
      console.error("ls did not include libs/demo-lib");
      process.exit(2);
    }
    await $`scaf update libs/demo-lib`;
    await $`scaf regen libs/demo-lib`;
    console.log("OK — scaffolding e2e passed:", tmp);
  } finally {
    process.chdir(cwd);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
