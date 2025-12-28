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
  const rawAll: string[] = Array.isArray(process.argv) ? process.argv : [];

  // Node's argv shape is:
  //   [node, ...nodeFlags, scriptPath, ...userArgs]
  //
  // In this repo we commonly run scripts with node flags (e.g. --import zx-init.mjs),
  // so `process.argv.slice(2)` would incorrectly include node runtime flags and the
  // script path. That breaks argument parsing for tools that operate on "argv tokens".
  //
  // We instead find the script path token and return only the args after it.
  const isScriptPathToken = (t: string): boolean => {
    if (!t) return false;
    // Never treat node flags (including NODE_OPTIONS-injected flags like --import=...) as the script.
    if (t.startsWith("-")) return false;
    // Common forms: /abs/path/tools/dev/foo.ts, ./foo.ts, foo.js, foo.mjs, etc.
    return /\.(ts|js|mjs|cjs)$/.test(t);
  };

  // In this repo we frequently run:
  //   node ... --import <zx-init.mjs> <script.ts> <args...>
  // so we must skip node flags that consume the next token to avoid mistaking the
  // import path for the script path.
  const consumesNext = new Set(["--import", "--require", "-r", "--loader"]);
  let scriptIdx = -1;
  for (let i = 1; i < rawAll.length; i++) {
    const a = String(rawAll[i] || "");
    if (consumesNext.has(a)) {
      i++; // skip its value token
      continue;
    }
    if (isScriptPathToken(a)) {
      scriptIdx = i;
      break;
    }
  }

  const user = scriptIdx >= 0 ? rawAll.slice(scriptIdx + 1) : rawAll.slice(2);
  return user.filter((s) => typeof s === "string");
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
