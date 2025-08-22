#!/usr/bin/env zx-wrapper
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

async function rsyncRepoTo(tmp: string) {
  await $`bash -lc 'rsync -a --exclude "buck-out" --exclude "node_modules" --exclude ".git" --exclude "libs" --exclude ".tmp" ./ ${tmp}/'`;
}

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scaf-smoke-"));
  await rsyncRepoTo(tmp);
  try {
    const name = "demo-lib";
    const absDest = path.join(tmp, "libs", name);
    await $({ cwd: tmp })`scaf new go lib ${name}`;
    const readme = path.join(absDest, "README.md");
    const exists = await fs.pathExists(readme);
    if (!exists) {
      console.error("README.md missing in scaffold; listing dest and parent:");
      try { await $`ls -la ${absDest}`; } catch {}
      try { await $`ls -la ${path.dirname(absDest)}`; } catch {}
      process.exit(2);
    }
    const content = await fs.readFile(readme, "utf8");
    if (!content.includes(`# ${name} (Go library)`)) {
      console.error("README.md content did not render expected title:");
      console.error(content);
      process.exit(2);
    }
    console.log("OK — scaffolding smoke test passed:", path.relative(tmp, absDest));
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
}

main().catch(e => { console.error(e); process.exit(1); });
