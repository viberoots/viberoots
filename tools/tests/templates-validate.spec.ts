#!/usr/bin/env zx-wrapper
import os from "node:os";
import path from "node:path";
import * as fsp from "node:fs/promises";

async function rsyncRepoTo(tmp: string) {
  await $`bash -lc 'rsync -a --exclude "buck-out" --exclude "node_modules" --exclude ".git" ./ ${tmp}/'`;
}

async function runValidator(tmp: string, expectPass: boolean) {
  try {
    const res = await $({ cwd: tmp, stdio: 'pipe' })`tools/tests/templates-validate.ts`;
    if (!expectPass) {
      console.error("validator unexpectedly passed\n", res.stdout);
      process.exit(2);
    }
  } catch (e: any) {
    if (expectPass) {
      console.error("validator unexpectedly failed\n", e?.stderr || e);
      process.exit(2);
    }
  }
}

async function main() {
  // Valid case
  {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmpl-validate-pass-"));
    await rsyncRepoTo(tmp);
    await runValidator(tmp, true);
    await fsp.rm(tmp, { recursive: true, force: true });
  }

  // Invalid: remove help.md from a template
  {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmpl-validate-fail-"));
    await rsyncRepoTo(tmp);
    const bad = path.join(tmp, "tools", "scaffolding", "templates", "go", "lib", "help.md");
    await fsp.rm(bad, { force: true });
    await runValidator(tmp, false);
    await fsp.rm(tmp, { recursive: true, force: true });
  }

  // Invalid: add a bogus help field to meta.json
  {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tmpl-validate-fail2-"));
    await rsyncRepoTo(tmp);
    const metaPath = path.join(tmp, "tools", "scaffolding", "templates", "go", "lib", "meta.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
    meta.help = { usage: "bogus" };
    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    await runValidator(tmp, false);
    await fsp.rm(tmp, { recursive: true, force: true });
  }

  console.log("OK — templates-validate.ts tested pass/fail scenarios");
}

main().catch(e => { console.error(e); process.exit(1); });
