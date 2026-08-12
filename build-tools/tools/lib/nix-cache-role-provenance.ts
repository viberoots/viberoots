import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type CacheRoles = {
  required: string[];
  optional: string[];
};

type ParseState = CacheRoles & {
  visited: Set<string>;
};

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_INCLUDE_DEPTH = 32;

function words(value: string): string[] {
  return value.trim().split(/\s+/u).filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stripComment(line: string): string {
  const comment = line.indexOf("#");
  return (comment >= 0 ? line.slice(0, comment) : line).trim();
}

function applyConfigText(text: string, baseDir: string, state: ParseState, depth: number): void {
  if (depth > MAX_INCLUDE_DEPTH) throw new Error("Nix config include depth exceeded");
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = stripComment(rawLine);
    if (!line) continue;
    const include = line.match(/^(!?include)\s+(.+)$/u);
    if (include) {
      const optional = include[1] === "!include";
      const includePath = path.resolve(baseDir, include[2].trim());
      if (!fs.existsSync(includePath)) {
        if (optional) continue;
        throw new Error("required Nix config include is unavailable");
      }
      applyConfigFile(includePath, state, depth + 1);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = words(line.slice(eq + 1));
    if (key === "substituters") {
      state.required = unique(value);
      state.optional = [];
    } else if (key === "extra-substituters") {
      state.optional = unique([
        ...state.optional,
        ...value.filter((entry) => !state.required.includes(entry)),
      ]);
    }
  }
}

function applyConfigFile(file: string, state: ParseState, depth: number): void {
  const resolved = fs.realpathSync(file);
  if (state.visited.has(resolved)) throw new Error("Nix config include cycle");
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) {
    throw new Error("Nix config source is not a bounded regular file");
  }
  state.visited.add(resolved);
  try {
    applyConfigText(fs.readFileSync(resolved, "utf8"), path.dirname(resolved), state, depth);
  } finally {
    state.visited.delete(resolved);
  }
}

function existingDefaultConfigFiles(env: NodeJS.ProcessEnv): string[] {
  const system = path.join(String(env.NIX_CONF_DIR || "/etc/nix"), "nix.conf");
  const files = fs.existsSync(system) ? [system] : [];
  if (Object.prototype.hasOwnProperty.call(env, "NIX_USER_CONF_FILES")) {
    return [
      ...files,
      ...String(env.NIX_USER_CONF_FILES || "")
        .split(path.delimiter)
        .filter(Boolean)
        .reverse()
        .filter((file) => fs.existsSync(file)),
    ];
  }
  const configDirs = String(env.XDG_CONFIG_DIRS || "/etc/xdg")
    .split(path.delimiter)
    .filter(Boolean)
    .reverse()
    .map((dir) => path.join(dir, "nix", "nix.conf"))
    .filter((file) => fs.existsSync(file));
  const configHome = String(
    env.XDG_CONFIG_HOME || path.join(String(env.HOME || ""), ".config"),
  ).trim();
  const user = configHome ? path.join(configHome, "nix", "nix.conf") : "";
  return [...files, ...configDirs, ...(user && fs.existsSync(user) ? [user] : [])];
}

function sameMembers(left: string[], right: string[]): boolean {
  const a = unique(left);
  const b = unique(right);
  return a.length === b.length && a.every((entry) => b.includes(entry));
}

export function resolveNixCacheRoleProvenance(args: {
  env?: NodeJS.ProcessEnv;
  effectiveSubstituters: string[];
  defaultSubstituters: string[];
}): CacheRoles | undefined {
  const env = args.env || process.env;
  const state: ParseState = {
    required: unique(args.defaultSubstituters),
    optional: [],
    visited: new Set(),
  };
  try {
    for (const file of existingDefaultConfigFiles(env)) applyConfigFile(file, state, 0);
    if (Object.prototype.hasOwnProperty.call(env, "NIX_CONFIG")) {
      applyConfigText(String(env.NIX_CONFIG || ""), process.cwd(), state, 0);
    }
  } catch {
    return undefined;
  }
  state.optional = state.optional.filter((entry) => !state.required.includes(entry));
  const combined = unique([...state.required, ...state.optional]);
  if (!sameMembers(combined, args.effectiveSubstituters)) return undefined;
  return { required: unique(state.required), optional: unique(state.optional) };
}

export function readEffectiveNixCacheRoleProvenance(
  nixBin: string,
  env: NodeJS.ProcessEnv = process.env,
): CacheRoles | undefined {
  try {
    const raw = execFileSync(nixBin, ["config", "show", "--json"], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(raw) as {
      substituters?: { value?: string[]; defaultValue?: string[] };
    };
    return resolveNixCacheRoleProvenance({
      env,
      effectiveSubstituters: parsed.substituters?.value || [],
      defaultSubstituters: parsed.substituters?.defaultValue || [],
    });
  } catch {
    return undefined;
  }
}
