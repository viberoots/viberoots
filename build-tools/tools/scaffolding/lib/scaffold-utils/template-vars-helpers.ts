import * as fsp from "node:fs/promises";
import path from "node:path";

import { pathExists } from "../../../lib/repo";

export const AUTO_INFERRED_KEYS = new Set(["importer", "lockfilePath", "pkgScope"]);

export type TemplateVarsContext = {
  targetDir: string;
  templateDir: string;
  answersMap: Record<string, string>;
  inoutData?: Record<string, any>;
};

export function yamlScalar(value: string): string {
  const v = String(value);
  if (/^(?:true|false|null|~)$/i.test(v)) return v.toLowerCase();
  if (/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v)) return v;
  if (/^[A-Za-z0-9_./-]+$/.test(v)) return v;
  return JSON.stringify(v);
}

function toPosixPath(s: string): string {
  return String(s || "").replace(/\\/g, "/");
}

function normalizeImporterLike(s: string): string {
  const raw = toPosixPath(String(s || "").trim());
  if (!raw) return "";
  const noLeading = raw.replace(/^\.\/+/, "");
  return noLeading.replace(/\/+$/, "");
}

function inferImporterFromContext(ctx: {
  targetDir: string;
  answersMap: Record<string, string>;
  inoutData?: Record<string, any>;
}): string {
  const lockFromData = String(ctx.inoutData?.lockfilePath || "").trim();
  const lockFromAnswers = String(ctx.answersMap.lockfilePath || "").trim();
  const lockfilePath = normalizeImporterLike(lockFromData || lockFromAnswers);
  if (lockfilePath.endsWith("/pnpm-lock.yaml")) {
    return lockfilePath.slice(0, -"/pnpm-lock.yaml".length);
  }
  const importerFromData = normalizeImporterLike(String(ctx.inoutData?.importer || ""));
  if (importerFromData) return importerFromData;
  const importerFromAnswers = normalizeImporterLike(String(ctx.answersMap.importer || ""));
  if (importerFromAnswers) return importerFromAnswers;
  return normalizeImporterLike(ctx.targetDir);
}

export async function readTemplateVars(templateDir: string): Promise<string[]> {
  const candidates = ["copier.yaml", "copier.yml"];
  const vars: string[] = [];
  const reserved = new Set([
    "version",
    "_envops",
    "_exclude",
    "_tasks",
    "_answers_file",
    "_templates_suffix",
  ]);
  for (const c of candidates) {
    const p = path.join(templateDir, c);
    if (await pathExists(p)) {
      const txt = await fsp.readFile(p, "utf8").catch(() => "");
      for (const m of txt.matchAll(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(?:"[^"]*"|\S*)\s*$/gm)) {
        const key = m[1];
        if (!key.startsWith("_") && !reserved.has(key)) vars.push(key);
      }
      break;
    }
  }
  return Array.from(new Set(vars));
}

export async function readAnswersMap(answersFile: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const txt = await fsp.readFile(answersFile, "utf8").catch(() => "");
  for (const m of txt.matchAll(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/gm)) {
    const k = m[1];
    const v = (m[2] || "").trim();
    if (!k.startsWith("_")) out[k] = v;
  }
  return out;
}

export async function computeDefaultForKey(
  key: string,
  ctx: TemplateVarsContext,
): Promise<string | undefined> {
  if (ctx.inoutData && typeof ctx.inoutData[key] === "string") return ctx.inoutData[key] as string;
  if (typeof ctx.answersMap[key] === "string" && ctx.answersMap[key]) return ctx.answersMap[key];

  if (key === "name") return path.basename(ctx.targetDir);
  if (key === "language") {
    const parts = ctx.templateDir.split(path.sep);
    const idx = Math.max(0, parts.indexOf("templates"));
    const lang = parts[idx + 1];
    if (lang) return lang;
  }
  if (key === "template") {
    const parts = ctx.templateDir.split(path.sep);
    const idx = Math.max(0, parts.indexOf("templates"));
    const tmpl = parts[idx + 2];
    if (tmpl) return tmpl;
  }
  if (key === "lang_id") return path.basename(ctx.targetDir);
  if (key === "display_name") {
    const base = path.basename(ctx.targetDir);
    return base.charAt(0).toUpperCase() + base.slice(1);
  }
  if (key === "module") {
    try {
      const goModPath = path.join(ctx.targetDir, "go.mod");
      const txt = await fsp.readFile(goModPath, "utf8");
      const m = /^\s*module\s+(\S+)/m.exec(txt);
      if (m && m[1]) return m[1];
    } catch {}
    const base = path.basename(ctx.targetDir).replace(/[^a-zA-Z0-9._-]+/g, "-");
    return `example.com/local/${base}`;
  }
  if (key === "description") {
    const base = path.basename(ctx.targetDir).replace(/[^a-zA-Z0-9._-]+/g, "-");
    return `${base} library`;
  }
  if (key === "importer") return inferImporterFromContext(ctx) || undefined;
  if (key === "lockfilePath") {
    const importer = inferImporterFromContext(ctx);
    if (!importer) return undefined;
    return `${importer}/pnpm-lock.yaml`;
  }
  if (key === "pkgScope") {
    const importer = inferImporterFromContext(ctx);
    if (importer.startsWith("projects/apps/")) return "@apps";
    if (importer.startsWith("projects/libs/")) return "@libs";
    return undefined;
  }
  if (key === "includeNodeTests") return "true";
  if (key === "go_min") return "1.22";
  if (key === "license") return "MIT";
  if (key === "enable_ci") return "true";
  return undefined;
}
