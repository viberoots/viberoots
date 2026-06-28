import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const UNSUPPORTED_INHERITED_NIX_CONFIG_KEYS = new Set(["eval-cores", "lazy-trees"]);
const REQUIRED_NIX_CONFIG_SETTINGS = new Map([["warn-dirty", "false"]]);

function emptyNixConfDir(): string {
  const dir = path.join(os.tmpdir(), "viberoots-empty-nix-conf");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sanitizeInheritedNixConfig(config: string | undefined): string | undefined {
  const seen = new Set<string>();
  const kept =
    typeof config === "string"
      ? config
          .split(/\r?\n/)
          .filter((line) => {
            const match = line.match(/^\s*([A-Za-z0-9._-]+)\s*=/);
            if (!match) return true;
            const key = match[1];
            if (UNSUPPORTED_INHERITED_NIX_CONFIG_KEYS.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((line) => line.trimEnd())
          .filter(Boolean)
      : [];
  for (const [key, value] of REQUIRED_NIX_CONFIG_SETTINGS) {
    if (!seen.has(key)) kept.push(`${key} = ${value}`);
  }
  const rendered = kept.join("\n").trim();
  return rendered || undefined;
}

export function withSanitizedInheritedNixConfig<
  T extends { NIX_CONFIG?: string; NIX_CONF_DIR?: string },
>(env: T): T {
  const sanitized = sanitizeInheritedNixConfig(env.NIX_CONFIG);
  if (sanitized === undefined) {
    delete env.NIX_CONFIG;
  } else {
    env.NIX_CONFIG = sanitized;
  }
  env.NIX_CONF_DIR = env.NIX_CONF_DIR || emptyNixConfDir();
  return env;
}
