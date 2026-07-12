import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { runManagedCommand } from "../../lib/managed-command";
import { withSanitizedInheritedNixConfig } from "../../lib/nix-config-env";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";
import { prepareExactPnpmStore } from "./exact-store";

const REALIZED_FIXED_STORE_TIMEOUT_MS = 30_000;

async function realizedFixedStoreRoot(opts: {
  repoRoot: string;
  flakeRef: string;
  attrPath: string;
}): Promise<string | null> {
  const env = envWithResolvedNixBin(process.env);
  delete env.NIX_PNPM_EXACT_STORE;
  const nixBin = resolveToolPathSync("nix", env);
  const result = await runManagedCommand({
    command: nixBin,
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

function baseFlakeRef(flakeRef: string): string {
  return String(flakeRef || "").replace(/#.*$/, "");
}

export async function resolveExactPrefetchedStore(opts: {
  repoRoot: string;
  importer: string;
  flakeRef: string;
  attrPath: string;
}): Promise<{ exactStorePath: string; cleanup: () => Promise<void> }> {
  const flakeRef = baseFlakeRef(opts.flakeRef);
  const realizedStoreRoot = await realizedFixedStoreRoot({ ...opts, flakeRef });
  if (realizedStoreRoot) {
    console.log(
      `[update-pnpm-hash] importer=${opts.importer} step=realized-fixed-store attr=${opts.attrPath} exact-store=${realizedStoreRoot}`,
    );
    return { exactStorePath: realizedStoreRoot, cleanup: async () => {} };
  }
  return await prepareExactPnpmStore({ repoRoot: opts.repoRoot, importer: opts.importer });
}

export async function withResolvedExactPrefetchedStore<T>(
  opts: { repoRoot: string; importer: string; flakeRef: string; attrPath: string },
  fn: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const resolved = await resolveExactPrefetchedStore(opts);
  try {
    return await fn(
      withSanitizedInheritedNixConfig(
        envWithResolvedNixBin({
          ...process.env,
          NIX_PNPM_EXACT_STORE: resolved.exactStorePath,
        }),
      ),
    );
  } finally {
    await resolved.cleanup();
  }
}
