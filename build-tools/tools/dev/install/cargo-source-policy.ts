import * as fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";

type CargoSourcePolicy = {
  supported_lock_sources?: unknown;
  supported_lock_source_prefixes?: unknown;
  supported_git_source_pattern?: unknown;
};

const policyFile = fileURLToPath(
  new URL("../../../rust/cargo-source-policy.json", import.meta.url),
);

export async function assertSupportedCargoLockSources(lockFile: string): Promise<void> {
  const policy = JSON.parse(await fsp.readFile(policyFile, "utf8")) as CargoSourcePolicy;
  if (
    !Array.isArray(policy.supported_lock_sources) ||
    policy.supported_lock_sources.some((source) => typeof source !== "string")
  ) {
    throw new Error("Rust Cargo source policy must declare supported_lock_sources strings");
  }
  const supported = new Set(policy.supported_lock_sources as string[]);
  const prefixes = Array.isArray(policy.supported_lock_source_prefixes)
    ? policy.supported_lock_source_prefixes.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const gitPattern =
    typeof policy.supported_git_source_pattern === "string"
      ? new RegExp(policy.supported_git_source_pattern)
      : null;
  for (const line of (await fsp.readFile(lockFile, "utf8")).split(/\r?\n/)) {
    const quotedAssignment = /^\s*(?:"(?:[^"\\]|\\.)*"|'[^']*')\s*=/.test(line);
    if (quotedAssignment && !/^\s*(?:"source"|'source')\s*=/.test(line)) {
      throw new Error(`Rust Cargo.lock contains unsupported quoted assignment key: ${line}`);
    }
    if (!/^\s*(?:source|"source"|'source')\s*=/.test(line)) continue;
    const assignment = line.match(
      /^\s*(?:source|"source"|'source')\s*=\s*(?:"([^"\\]*)"|'([^']*)')\s*(?:#.*)?$/,
    );
    if (!assignment) {
      throw new Error(`Rust Cargo.lock contains unsupported source assignment syntax: ${line}`);
    }
    const source = assignment[1] ?? assignment[2];
    if (
      !supported.has(source) &&
      !prefixes.some((prefix) => source.startsWith(prefix)) &&
      !gitPattern?.test(source)
    ) {
      throw new Error(`Rust Cargo.lock contains unsupported dependency source: ${source}`);
    }
  }
}
