#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

async function findGoModules(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth = 0) {
    if (depth > 4) return;
    const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as any);
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if ([".git", "buck-out", "node_modules", "coverage", ".direnv", ".clinic"].includes(e.name))
          continue;
        if (await fs.pathExists(path.join(p, "go.mod"))) out.push(p);
        await walk(p, depth + 1);
      }
    }
  }
  await walk(root, 0);
  return Array.from(new Set(out));
}

async function readGomod2nix(root: string): Promise<Record<string, string>> {
  const toml = path.join(root, "gomod2nix.toml");
  const map: Record<string, string> = {};
  if (!(await fs.pathExists(toml))) return map;
  const txt = await fs.readFile(toml, "utf8");
  let cur: string | null = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    const mSec = line.match(/^\["?([^\]"]+)"?\]$/);
    if (mSec) {
      cur = mSec[1];
      continue;
    }
    if (cur) {
      const mVer = line.match(/^version\s*=\s*"([^"]+)"/);
      if (mVer) map[cur] = mVer[1];
    }
  }
  return map;
}

async function gomodcachePath(): Promise<string> {
  try {
    const { stdout } = await $({ stdio: "pipe" })`go env GOMODCACHE`;
    return String(stdout || "").trim();
  } catch {
    return "";
  }
}

async function vendor(root: string) {
  const mods = await findGoModules(root);
  const versions = await readGomod2nix(root);
  const gmc = await gomodcachePath();
  if (!gmc) return;
  for (const mdir of mods) {
    const vendorDir = path.join(mdir, "vendor");
    await fs.mkdirp(vendorDir);
    for (const [importPath, ver] of Object.entries(versions)) {
      const origin = path.join(gmc, `${importPath}@${ver}`);
      const dst = path.join(vendorDir, importPath);
      if (!(await fs.pathExists(origin))) continue;
      await fs.mkdirp(path.dirname(dst));
      await fs
        .copy(origin, dst, {
          overwrite: true,
          filter: (src) => !src.endsWith("_test.go"),
        })
        .catch(() => {});
    }
  }
}

async function main() {
  const root = process.cwd();
  await vendor(root);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
