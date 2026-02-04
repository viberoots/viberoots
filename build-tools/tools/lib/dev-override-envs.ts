import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type DevOverrideLang = "go" | "cpp" | "python";

export const DEV_OVERRIDE_LANGS: readonly DevOverrideLang[] = ["go", "cpp", "python"];

type Manifest = Record<string, string>;

function manifestPath(): string {
  const here = fileURLToPath(import.meta.url);
  return path.join(path.dirname(here), "dev-override-envs.json");
}

function readManifest(): Record<DevOverrideLang, string> {
  const p = manifestPath();
  let raw = "";
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`dev override env manifest is missing or unreadable: ${p}\n${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`dev override env manifest is invalid JSON: ${p}\n${msg}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`dev override env manifest must be a JSON object: ${p}`);
  }
  const obj = parsed as Manifest;

  const out: Partial<Record<DevOverrideLang, string>> = {};
  for (const lang of DEV_OVERRIDE_LANGS) {
    const v = obj[lang];
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`dev override env manifest missing entry for "${lang}": ${p}`);
    }
    out[lang] = v.trim();
  }
  return out as Record<DevOverrideLang, string>;
}

export function devOverrideEnvNameForLang(lang: DevOverrideLang): string {
  return readManifest()[lang];
}

export function allDevOverrideEnvNames(): string[] {
  const m = readManifest();
  return DEV_OVERRIDE_LANGS.map((k) => m[k]);
}
