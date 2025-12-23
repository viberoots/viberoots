#!/usr/bin/env zx-wrapper
/**
 * Minimal, consistent CLI flag helpers for zx scripts.
 *
 * Precedence for all helpers:
 * 1) global argv object (as populated by zx/yargs) when present
 * 2) process.argv parsing (supports --name value and --name=value)
 * 3) Default (for strings: def || ""; for booleans/lists: false/[])
 */

function readGlobalArg(name: string): unknown {
  try {
    const g: any = (globalThis as any).argv;
    if (g && Object.prototype.hasOwnProperty.call(g, name)) {
      return g[name];
    }
  } catch {}
  return undefined;
}

function readFromProcessArgv(name: string): { provided: boolean; value?: string } {
  const raw: string[] = Array.isArray(process.argv) ? process.argv : [];
  const needle = `--${name}`;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i] || "";
    if (a === needle) {
      const next = raw[i + 1];
      if (next && !next.startsWith("--")) {
        return { provided: true, value: next };
      }
      return { provided: true, value: "" };
    }
    if (a.startsWith(needle + "=")) {
      return { provided: true, value: a.slice(needle.length + 1) };
    }
  }
  return { provided: false };
}

export function getFlagStr(name: string, def: string = ""): string {
  // Prefer zx/yargs-populated argv
  const gVal = readGlobalArg(name);
  if (typeof gVal === "string" && gVal.trim() !== "") return gVal;
  // Fallback: process.argv
  const p = readFromProcessArgv(name);
  if (p.provided && typeof p.value === "string" && p.value !== "") return p.value;
  return def;
}

export function getFlagBool(name: string): boolean {
  // Prefer zx/yargs-populated argv
  const gVal = readGlobalArg(name);
  if (typeof gVal === "boolean") return gVal;
  if (typeof gVal === "string") {
    const s = gVal.toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  // Fallback: process.argv — presence means true; equals-form can explicitly set
  const p = readFromProcessArgv(name);
  if (!p.provided) return false;
  if (typeof p.value === "string" && p.value !== "") {
    const s = p.value.toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "1") return true;
    if (s === "0") return false;
  }
  // `--flag` with no value: treat as true
  return true;
}

export function getFlagList(name: string): string[] {
  // Prefer zx/yargs-populated argv
  const gVal = readGlobalArg(name);
  if (Array.isArray(gVal)) {
    return (gVal as unknown[]).map((v) => String(v)).filter((v) => v.length > 0);
  }
  if (typeof gVal === "string" && gVal.trim() !== "") {
    return gVal
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  // Fallback: process.argv
  const p = readFromProcessArgv(name);
  if (typeof p.value === "string" && p.value.trim() !== "") {
    return p.value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

/**
 * Utility: check if a flag is present on the command line (global argv or process.argv).
 * Not part of the core acceptance criteria, but useful for preserving current behavior
 * in scripts that distinguish between defaulted and explicitly provided flags.
 */
export function hasFlag(name: string): boolean {
  const gVal = readGlobalArg(name);
  if (gVal !== undefined) return true;
  const p = readFromProcessArgv(name);
  return p.provided;
}

/**
 * getPositionals
 * Returns positional args in a consistent way across zx (global argv) and plain node (process.argv).
 *
 * Rules:
 * - If zx/yargs populated `globalThis.argv._`, use it.
 * - Otherwise, parse process.argv:
 *   - Skip flags like `--name` and `--name=value`
 *   - If a flag is in `--name value` form, also skip the value
 *   - Stop interpreting flags after `--` (everything after is positional)
 */
export function getPositionals(): string[] {
  const g: any = (globalThis as any).argv;
  if (g && Array.isArray(g._)) return (g._ as unknown[]).map((v) => String(v));
  const raw: string[] = Array.isArray(process.argv) ? process.argv.slice(2) : [];
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i] || "";
    if (a === "--") {
      out.push(...raw.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      // equals-form: `--name=value`
      if (a.includes("=")) continue;
      // two-token form: `--name value` → skip value token when present
      const nxt = raw[i + 1] || "";
      if (nxt && !nxt.startsWith("--")) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/**
 * echoSnippetRequested
 * Returns true when the caller should print an export snippet instead of
 * mutating in‑process environment state. Detection is uniform:
 * - Flag: --echo-snippet (supports zx global argv and process.argv)
 * - Optional env: pass the env var name to honor (e.g., PATCH_GO_ECHO_SNIPPET)
 *
 * Usage:
 *   echoSnippetRequested({ env: "PATCH_GO_ECHO_SNIPPET" })
 *   echoSnippetRequested({ env: "PATCH_CPP_ECHO_SNIPPET" })
 */
export function echoSnippetRequested(opts?: { env?: string }): boolean {
  if (getFlagBool("echo-snippet")) return true;
  // Per-language env toggle (back-compat)
  const name = (opts?.env || "").trim();
  if (name && typeof process.env[name] === "string") {
    const v = String(process.env[name] || "")
      .trim()
      .toLowerCase();
    if (v === "1" || v === "true") return true;
  }
  // Global env toggle
  try {
    const g = String(process.env.PATCH_ECHO_SNIPPET || "")
      .trim()
      .toLowerCase();
    if (g === "1" || g === "true") return true;
  } catch {}
  return false;
}

/**
 * normalizeTargetToPkg
 * Accepts a Buck target string and returns the package path portion suitable
 * for constructing local patch directories.
 */
export function normalizeTargetToPkg(t: string): string {
  if (!t) return "";
  if (t.startsWith("//")) {
    const noCell = t.slice(2);
    return noCell.split(":")[0] || "";
  }
  return t.split(":")[0] || "";
}

/**
 * readTargetArg — reads --target and returns the normalized package path.
 */
export function readTargetArg(def: string = ""): string {
  const raw = getFlagStr("target", def).trim();
  return normalizeTargetToPkg(raw);
}

/**
 * readPatchDirArg — reads --patch-dir (or legacy --patchDir) value.
 */
export function readPatchDirArg(def: string = ""): string {
  const v = (getFlagStr("patch-dir", "") || getFlagStr("patchDir", "")).trim();
  return v || def;
}

/**
 * readForceFlag — standardized reader for --force.
 */
export function readForceFlag(): boolean {
  return getFlagBool("force");
}

/**
 * readImporterArg — standardized reader for Node's --importer flag.
 */
export function readImporterArg(def: string = ""): string {
  return getFlagStr("importer", def).trim();
}
