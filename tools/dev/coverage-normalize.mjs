#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

function mapTmpToRepo(sf, repoRoot) {
  // If path contains any temp prefix before /tools/, rewrite to repoRoot by stripping prefix
  const idx = sf.indexOf(`${path.sep}tools${path.sep}`);
  if (idx > -1) {
    const suffix = sf.slice(idx + 1); // drop leading slash for join behavior
    return path.join(repoRoot, suffix);
  }
  // file:// prefixes
  const url = sf.startsWith("file://") ? sf : undefined;
  if (url) {
    try {
      const u = new URL(url);
      const p = u.pathname;
      return mapTmpToRepo(p, repoRoot);
    } catch {}
  }
  // Relative repo paths like 'tools/...'
  if (sf.startsWith(`tools${path.sep}`)) return path.join(repoRoot, sf);
  if (sf.startsWith(`.${path.sep}tools${path.sep}`)) return path.join(repoRoot, sf.slice(2));
  return sf;
}

async function normalizeLcov(repoRoot) {
  const lcovFile = path.join(repoRoot, "coverage", "lcov.info");
  if (!fs.existsSync(lcovFile)) return;
  const txt = await fsp.readFile(lcovFile, "utf8");
  const recs = txt.split(/\nend_of_record\n?/);
  const byFile = new Map();
  for (const r of recs) {
    if (!r.trim()) continue;
    const lines = r.split(/\n/);
    const sfLine = lines.find((l) => l.startsWith("SF:"));
    if (!sfLine) continue;
    const sfPath = sfLine.slice(3);
    const newSf = mapTmpToRepo(sfPath, repoRoot);
    const newSfAbs = path.isAbsolute(newSf) ? newSf : path.join(repoRoot, newSf);
    // Collect DA, FN, FNDA, BRDA/BRF/BRH
    const das = new Map();
    const fns = new Map(); // name -> line
    const fndas = new Map(); // name -> hits
    const brdas = new Map(); // key -> count
    let brf = 0,
      brh = 0;
    for (const l of lines) {
      if (l.startsWith("DA:")) {
        const [, payload] = l.split(":");
        const [ln, cnt] = payload.split(",");
        const n = parseInt(cnt, 10) || 0;
        const prev = das.get(ln) || 0;
        if (n > prev) das.set(ln, n);
      } else if (l.startsWith("FN:")) {
        const [, payload] = l.split(":");
        const [lineStr, name] = payload.split(",");
        if (name) fns.set(name, parseInt(lineStr, 10) || 0);
      } else if (l.startsWith("FNDA:")) {
        const [, payload] = l.split(":");
        const [hitsStr, name] = payload.split(",");
        if (name) {
          const hits = parseInt(hitsStr, 10) || 0;
          const prev = fndas.get(name) || 0;
          if (hits > prev) fndas.set(name, hits);
        }
      } else if (l.startsWith("BRDA:")) {
        const key = l.slice(5);
        const parts = key.split(",");
        const cntStr = parts[3] || "-";
        const cnt = cntStr === "-" ? 0 : parseInt(cntStr, 10) || 0;
        const prev = brdas.get(key) || 0;
        if (cnt > prev) brdas.set(key, cnt);
      } else if (l.startsWith("BRF:")) {
        brf = Math.max(brf, parseInt(l.slice(4), 10) || 0);
      } else if (l.startsWith("BRH:")) {
        brh = Math.max(brh, parseInt(l.slice(4), 10) || 0);
      }
    }
    const entry = byFile.get(newSfAbs) || {
      das: new Map(),
      fns: new Map(),
      fndas: new Map(),
      brdas: new Map(),
      brf: 0,
      brh: 0,
    };
    for (const [ln, n] of das) entry.das.set(ln, Math.max(entry.das.get(ln) || 0, n));
    for (const [name, ln] of fns) if (!entry.fns.has(name)) entry.fns.set(name, ln);
    for (const [name, hits] of fndas)
      entry.fndas.set(name, Math.max(entry.fndas.get(name) || 0, hits));
    for (const [k, c] of brdas) entry.brdas.set(k, Math.max(entry.brdas.get(k) || 0, c));
    entry.brf = Math.max(entry.brf, brf);
    entry.brh = Math.max(entry.brh, brh);
    byFile.set(newSfAbs, entry);
  }
  // Re-emit minimal lcov with merged DA entries
  let out = "";
  for (const [sf, entry] of byFile) {
    out += `SF:${sf}\n`;
    for (const [name, ln] of entry.fns) out += `FN:${ln},${name}\n`;
    for (const [name, hits] of entry.fndas) out += `FNDA:${hits},${name}\n`;
    for (const [ln, n] of entry.das) out += `DA:${ln},${n}\n`;
    for (const [k, c] of entry.brdas) {
      out += `BRDA:${k}\n`;
    }
    if (entry.brf) out += `BRF:${entry.brf}\n`;
    if (entry.brh) out += `BRH:${entry.brh}\n`;
    out += "end_of_record\n";
  }
  await fsp.writeFile(lcovFile, out, "utf8");
}

async function normalizeSummary(repoRoot) {
  const f = path.join(repoRoot, "coverage", "coverage-summary.json");
  if (!fs.existsSync(f)) return;
  const j = JSON.parse(await fsp.readFile(f, "utf8"));
  const out = {};
  for (const [k, v] of Object.entries(j)) {
    if (k === "total") {
      out[k] = v;
      continue;
    }
    const mapped = mapTmpToRepo(k, repoRoot);
    out[mapped] = v;
  }
  await fsp.writeFile(f, JSON.stringify(out, null, 2), "utf8");
}

async function main() {
  const repoRoot = process.cwd();
  await normalizeLcov(repoRoot).catch(() => {});
  await normalizeSummary(repoRoot).catch(() => {});
}

main();
