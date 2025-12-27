#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

function mapTmpToRepo(sf, repoRoot) {
  const sep = path.sep;
  const idx = sf.indexOf(`${sep}tools${sep}`);
  if (idx > -1) {
    const suffix = sf.slice(idx + 1);
    return path.join(repoRoot, suffix);
  }
  if (sf.startsWith("file://")) {
    try {
      const u = new URL(sf);
      return mapTmpToRepo(u.pathname, repoRoot);
    } catch {}
  }
  if (sf.startsWith(`tools${sep}`)) return path.join(repoRoot, sf);
  if (sf.startsWith(`.${sep}tools${sep}`)) return path.join(repoRoot, sf.slice(2));
  return sf;
}

async function normalizeRaw(repoRoot) {
  const envDir = process.env.NODE_V8_COVERAGE;
  const dir = envDir ? path.resolve(envDir) : path.join(repoRoot, "coverage", "raw");
  if (!fs.existsSync(dir)) return;
  const files = (await fsp.readdir(dir)).filter(
    (f) => f.startsWith("coverage-") && f.endsWith(".json"),
  );
  for (const f of files) {
    const p = path.join(dir, f);
    let j;
    try {
      j = JSON.parse(await fsp.readFile(p, "utf8"));
    } catch {
      continue;
    }
    if (!j || !Array.isArray(j.result)) continue;
    let changed = false;
    for (const entry of j.result) {
      const url = entry && entry.url;
      if (!url || typeof url !== "string") continue;
      const mapped = mapTmpToRepo(url, repoRoot);
      if (mapped && mapped !== url) {
        entry.url = mapped.startsWith("/") ? `file://${mapped}` : mapped;
        changed = true;
      }
    }
    if (changed) {
      await fsp.writeFile(p, JSON.stringify(j));
    }
  }
}

async function main() {
  const repoRoot = process.cwd();
  await normalizeRaw(repoRoot).catch(() => {});
}

main();
