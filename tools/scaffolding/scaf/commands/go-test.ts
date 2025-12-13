import type { ScafContext, ScafFlags } from "../types.ts";

import path from "node:path";

import * as fsp from "node:fs/promises";

import { exists } from "../fs.ts";

function ensureSuffix(name: string, suffix: string): string {
  return name.endsWith(suffix) ? name : name + suffix;
}

function toPascalCase(s: string): string {
  const parts = s
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  return parts.map((p) => (p ? p[0].toUpperCase() + p.slice(1) : "")).join("");
}

function sanitizePkgName(s: string): string {
  let t = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  if (!/^[a-z_]/.test(t)) t = "_" + t;
  return t || "pkg";
}

async function inferPackageName(dir: string, destPath: string): Promise<string> {
  try {
    const entries = await fsp.readdir(dir);
    for (const e of entries) {
      if (!e.endsWith(".go")) continue;
      const txt = await fsp.readFile(path.join(dir, e), "utf8").catch(() => "");
      const m = /^\s*package\s+([a-zA-Z_][a-zA-Z0-9_]*)/m.exec(txt);
      if (m && m[1]) return m[1];
    }
  } catch {}
  if (destPath.includes(`${path.sep}cmd${path.sep}`)) return "main";
  return sanitizePkgName(path.basename(dir));
}

function defaultDestFromCwd(ctx: ScafContext, file: string): string {
  const rel = path.relative(ctx.repoRoot, ctx.originalCwd);
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts[0] === "apps" && parts[1]) {
    const app = parts[1];
    if (parts[2] === "cmd" && parts[3] === app) {
      return path.join(ctx.originalCwd, file);
    }
    return path.join(ctx.repoRoot, "apps", app, "cmd", app, file);
  }
  if (parts[0] === "libs" && parts[1]) {
    const lib = parts[1];
    if (parts[2] === "pkg" && parts[3]) {
      return path.join(ctx.originalCwd, file);
    }
    return path.join(ctx.repoRoot, "libs", lib, "pkg", lib, file);
  }
  return path.join(ctx.originalCwd, file);
}

export async function cmdGoTest(ctx: ScafContext, name: string, flags: ScafFlags) {
  const yes = flags["yes"] === "true";
  const dry = flags["dry-run"] === "true";
  const provided = flags["path"];
  const filename = ensureSuffix(name, "_test.go");
  const dest = provided ? provided : defaultDestFromCwd(ctx, filename);
  const dir = path.dirname(dest);

  const summary = `Create Go test: ${dest}`;
  if (!yes && !dry && (await exists(dest))) {
    console.error(`${summary}\nRefusing to overwrite without --yes`);
    process.exit(2);
  }
  if (dry) {
    const pkg = await inferPackageName(dir, dest);
    console.log(`[dry-run] would write ${dest} (package ${pkg})`);
    return;
  }
  await fsp.mkdir(dir, { recursive: true });
  const pkg = await inferPackageName(dir, dest);
  const funcName = toPascalCase(name);
  const contents = `package ${pkg}\n\nimport "testing"\n\nfunc Test${funcName}(t *testing.T) {\n}\n`;
  await fsp.writeFile(dest, contents, "utf8");
  try {
    await $`bash -lc ${`set -euo pipefail; go fmt ${dest} >/dev/null 2>&1 || true`}`;
  } catch {}

  const hintLib =
    dest.includes(`${path.sep}libs${path.sep}`) && dest.includes(`${path.sep}pkg${path.sep}`);
  const hintApp =
    dest.includes(`${path.sep}apps${path.sep}`) && dest.includes(`${path.sep}cmd${path.sep}`);
  if (!hintLib && !hintApp) {
    console.warn(
      "note: for auto-wiring, place tests under libs/<lib>/pkg/<pkg>/ (lib) or apps/<app>/cmd/<app>/ (app)",
    );
  }
  console.log("created:", dest);
}
