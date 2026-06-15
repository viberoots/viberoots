import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { runManagedCommand } from "../../lib/managed-command";
import { withExactPrefetchedStore } from "./exact-store";

const REALIZED_FIXED_STORE_TIMEOUT_MS = 30_000;

async function realizedFixedStoreRoot(opts: {
  repoRoot: string;
  flakeRef: string;
  attrPath: string;
}): Promise<string | null> {
  const env = { ...process.env };
  delete env.NIX_PNPM_EXACT_STORE;
  const result = await runManagedCommand({
    command: "nix",
    args: ["path-info", `${opts.flakeRef}#${opts.attrPath}`, "--impure", "--accept-flake-config"],
    cwd: opts.repoRoot,
    env,
    timeoutMs: REALIZED_FIXED_STORE_TIMEOUT_MS,
  });
  if (!result.ok) return null;
  const outPath =
    String(result.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || "";
  if (!outPath.startsWith("/nix/store/")) return null;
  return fs.existsSync(path.join(outPath, "store")) ? outPath : null;
}

export async function withResolvedExactPrefetchedStore<T>(
  opts: { repoRoot: string; importer: string; flakeRef: string; attrPath: string },
  fn: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const realizedStoreRoot = await realizedFixedStoreRoot(opts);
  if (realizedStoreRoot) {
    console.log(
      `[update-pnpm-hash] importer=${opts.importer} step=realized-fixed-store attr=${opts.attrPath} exact-store=${realizedStoreRoot}`,
    );
    return await fn({
      ...process.env,
      NIX_PNPM_EXACT_STORE: realizedStoreRoot,
    });
  }
  return await withExactPrefetchedStore({ repoRoot: opts.repoRoot, importer: opts.importer }, fn);
}
