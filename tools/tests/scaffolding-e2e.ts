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
    // Initialize git and commit initial scaffold
    await $`git init`;
    await $`git add -A`;
    await $`git commit -m "init scaffold"`;

    // Move
    await $`scaf move libs/demo-lib libs/demo-moved --yes`;
    // Commit move so update can run on a clean repo
    await $`git add -A`;
    await $`git commit -m "move scaffold"`;

    // Update should run cleanly now
    await $`scaf update libs/demo-moved`;

    // Delete
    await $`scaf delete libs/demo-moved --yes`;

    // Should not appear in ls
    const res = await $({ stdio: 'pipe' })`scaf ls --json`;
    const arr = JSON.parse(res.stdout.trim() || "[]");
    if (arr.some((r: any) => r.path.endsWith("libs/demo-moved"))) {
      console.error("delete failed: libs/demo-moved still listed");
      process.exit(2);
    }
    console.log("OK — scaffolding e2e passed:", tmp);
  } finally {
    process.chdir(cwd);
    await fs.remove(tmp).catch(() => {});
  }
}

main().catch(e => { console.error(e); process.exit(1); });
