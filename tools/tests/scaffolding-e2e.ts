#!/usr/bin/env zx-wrapper
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

async function rsyncRepoTo(tmp: string) {
  await $`bash -lc 'rsync -a --exclude "buck-out" --exclude "node_modules" --exclude ".git" --exclude "libs" --exclude ".tmp" ./ ${tmp}/'`;
}

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scaf-e2e-"));
  await rsyncRepoTo(tmp);
  try {
    await $({ cwd: tmp })`scaf new go lib demo-lib`;
    // Initialize git and commit initial scaffold
    await $({ cwd: tmp })`git init`;
    await $({ cwd: tmp })`git add -A`;
    await $({ cwd: tmp })`git commit -m "init scaffold"`;

    // Move
    await $({ cwd: tmp })`scaf move libs/demo-lib libs/demo-moved --yes`;
    // Commit move so update can run on a clean repo
    await $({ cwd: tmp })`git add -A`;
    await $({ cwd: tmp })`git commit -m "move scaffold"`;

    // Update should run cleanly now
    await $({ cwd: tmp })`scaf update libs/demo-moved`;

    // Delete
    await $({ cwd: tmp })`scaf delete libs/demo-moved --yes`;

    // Should not appear in ls
    const res = await $({ stdio: 'pipe', cwd: tmp })`scaf ls --json`;
    const arr = JSON.parse(res.stdout.trim() || "[]");
    if (arr.some((r: any) => r.path.endsWith("libs/demo-moved"))) {
      console.error("delete failed: libs/demo-moved still listed");
      process.exit(2);
    }
    console.log("OK — scaffolding e2e passed:", tmp);
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
}

main().catch(e => { console.error(e); process.exit(1); });
