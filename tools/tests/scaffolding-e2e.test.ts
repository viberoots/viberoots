#!/usr/bin/env zx-wrapper
import path from "node:path";
import * as fsp from "node:fs/promises";
import { rsyncRepoTo, mktemp } from "#tests/lib/test-helpers";

async function main() {
  const tmp = await mktemp("scaf-e2e-");
  await rsyncRepoTo(tmp);
  try {
    await $({ cwd: tmp })`scaf new go lib demo-lib`;
    await $({ cwd: tmp })`git init`;
    await $({ cwd: tmp })`git add -A`;
    await $({ cwd: tmp })`git commit -m "init scaffold"`;
    await $({ cwd: tmp })`scaf move libs/demo-lib libs/demo-moved --yes`;
    await $({ cwd: tmp })`git add -A`;
    await $({ cwd: tmp })`git commit -m "move scaffold"`;
    await $({ cwd: tmp })`scaf update libs/demo-moved`;
    await $({ cwd: tmp })`scaf delete libs/demo-moved --yes`;
    const res = await $({ stdio: 'pipe', cwd: tmp })`scaf ls --json`;
    const arr = JSON.parse(res.stdout.trim() || "[]");
    if (arr.some((r: any) => r.path.endsWith("libs/demo-moved"))) {
      console.error("delete failed: libs/demo-moved still listed");
      process.exit(2);
    }
    console.log("OK — scaffolding e2e passed:", tmp);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(e => { console.error(e); process.exit(1); });
