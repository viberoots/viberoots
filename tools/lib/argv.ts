#!/usr/bin/env zx-wrapper
/**
 * argv token utilities.
 *
 * These helpers operate on "argv tokens" (the array you would traditionally get
 * from process.argv.slice(2)). Centralizing token parsing prevents drift across
 * tooling scripts and keeps entrypoints free of bespoke argv parsing.
 */

export type FlagRead = { provided: boolean; value: string };

export function getArgvTokens(): string[] {
  const raw: string[] = Array.isArray(process.argv) ? process.argv.slice(2) : [];
  return raw.filter((s) => typeof s === "string");
}

export function hasShortFlag(letter: string, argv = getArgvTokens()): boolean {
  if (!letter || letter.length !== 1) return false;
  const needle = `-${letter}`;
  return argv.includes(needle);
}

export function readFlagFromTokens(name: string, argv = getArgvTokens()): FlagRead {
  const needle = `--${name}`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] || "";
    if (a === needle) {
      const next = argv[i + 1] || "";
      if (next && !next.startsWith("--")) return { provided: true, value: next };
      return { provided: true, value: "" };
    }
    if (a.startsWith(needle + "=")) {
      return { provided: true, value: a.slice(needle.length + 1) };
    }
  }
  return { provided: false, value: "" };
}

export function readFlagStrFromTokens(name: string, def = "", argv = getArgvTokens()): string {
  const r = readFlagFromTokens(name, argv);
  if (r.provided && r.value.trim() !== "") return r.value;
  return def;
}

export function readFlagBoolFromTokens(name: string, argv = getArgvTokens()): boolean {
  const r = readFlagFromTokens(name, argv);
  if (!r.provided) return false;
  const v = (r.value || "").trim().toLowerCase();
  if (v === "") return true;
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "1") return true;
  if (v === "0") return false;
  return true;
}

/**
 * parseFlagMap
 *
 * A minimal "flags map" parser for CLIs that intentionally accept free-form
 * `--key=value` pairs (and presence flags `--key`).
 *
 * - Supports `--key=value`
 * - Supports presence flags `--key` (value defaults to "true")
 * - Does NOT attempt to parse two-token `--key value` forms (by design)
 * - Preserves positional ordering
 */
export function parseFlagMap(argv = getArgvTokens()): {
  positionals: string[];
  flags: Record<string, string>;
} {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};

  for (const a of argv) {
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    const s = a.slice(2);
    if (!s) continue;
    const eq = s.indexOf("=");
    if (eq >= 0) {
      const key = s.slice(0, eq);
      const value = s.slice(eq + 1);
      if (key) flags[key] = value;
    } else {
      flags[s] = "true";
    }
  }

  return { positionals, flags };
}

/**
 * removeKnownFlags
 *
 * Drops a small set of known flags from argv tokens, leaving all other tokens
 * (including unknown flags and their values) intact.
 *
 * This is useful for tools that "wrap" another CLI (e.g., Buck2) and want to
 * strip their own wrapper flags while passing through the rest verbatim.
 */
export function removeKnownFlags(
  argv: string[],
  spec: { presence: ReadonlyArray<string>; takesValue: ReadonlyArray<string> },
): { argv: string[]; seen: Record<string, string> } {
  const presence = new Set(spec.presence);
  const takesValue = new Set(spec.takesValue);
  const out: string[] = [];
  const seen: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] || "";
    if (!a.startsWith("--")) {
      out.push(a);
      continue;
    }

    const eq = a.indexOf("=");
    const key = eq >= 0 ? a.slice(0, eq) : a;
    const isPresence = presence.has(key);
    const isTakesValue = takesValue.has(key);
    if (!isPresence && !isTakesValue) {
      out.push(a);
      continue;
    }

    // Known flag: record and drop it.
    if (eq >= 0) {
      seen[key] = a.slice(eq + 1);
      continue;
    }
    if (isTakesValue) {
      const nxt = argv[i + 1] || "";
      if (nxt && !nxt.startsWith("--")) {
        seen[key] = nxt;
        i++;
        continue;
      }
      seen[key] = "";
      continue;
    }
    // Presence flag: never consumes the next token.
    seen[key] = "";
  }

  return { argv: out, seen };
}
