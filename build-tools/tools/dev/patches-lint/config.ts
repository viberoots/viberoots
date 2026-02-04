import { getFlagBool, getFlagStr, hasFlag } from "../../lib/cli.ts";
import type { PatchesLintConfig, PatchesLintFormat, PatchesLintLang } from "./types.ts";

function normalizeFormat(v: unknown): PatchesLintFormat {
  const raw = String(v || "text").toLowerCase();
  return raw === "json" ? "json" : "text";
}

function normalizeLang(v: unknown): PatchesLintLang {
  const raw = String(v || "").toLowerCase();
  if (raw === "go" || raw === "node" || raw === "cpp" || raw === "python") return raw;
  return "";
}

function strictFromValue(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (s === "") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return true;
}

function readStrictFlag(): boolean {
  if (process.env.CI === "true") return true;

  if (!hasFlag("strict")) return false;
  // Preserve: `--strict` implies true; explicit values can flip it.
  return getFlagBool("strict") || strictFromValue(getFlagStr("strict", ""));
}

export function readPatchesLintConfig(): PatchesLintConfig {
  const strict = readStrictFlag();
  const lang = normalizeLang(getFlagStr("lang", ""));
  const format = normalizeFormat(getFlagStr("format", "text"));
  return { strict, lang, format };
}
