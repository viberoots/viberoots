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
