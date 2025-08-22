#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

async function exists(p: string) { try { await fsp.access(p); return true; } catch { return false; } }

async function main() {
  const root = path.join("tools","scaffolding","templates");
  const langs = await fsp.readdir(root);
  for (const l of langs) {
    const ldir = path.join(root, l);
    const tdirs = (await fsp.readdir(ldir, { withFileTypes: true })).filter(e=>e.isDirectory()).map(e=>e.name);
    for (const t of tdirs) {
      const tdir = path.join(ldir, t);
      const metaPath = path.join(tdir, "meta.json");
      if (!(await exists(metaPath))) { console.error(`missing meta.json: ${l}/${t}`); process.exit(2); }
      const meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
      for (const key of ["language","template"]) if (!meta[key]) { console.error(`meta.json missing ${key}: ${l}/${t}`); process.exit(2); }
      if (meta.language !== l || meta.template !== t) { console.error(`meta.json language/template mismatch: ${l}/${t}`); process.exit(2); }
      if (typeof meta.description !== "string") { console.error(`meta.json description must be string: ${l}/${t}`); process.exit(2); }
      const helpMd = path.join(tdir, "help.md");
      if (!(await exists(helpMd))) { console.error(`missing help.md: ${l}/${t}`); process.exit(2); }
      const md = await fsp.readFile(helpMd, "utf8");
      const required = ["# Summary","# Usage","# Variables","# Generated","# Post-steps","# Examples"];
      for (const h of required) if (!md.includes(h)) { console.error(`help.md missing section ${h}: ${l}/${t}`); process.exit(2); }
    }
  }
  console.log("OK — template meta/help validated");
}

main().catch(e => { console.error(e); process.exit(1); });
