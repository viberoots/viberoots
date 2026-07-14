import path from "node:path";
import process from "node:process";
import { withSanitizedInheritedNixConfig } from "../../lib/nix-config-env";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";
import { hashOwnerForLockfile, readNodeModulesHashForLockfile } from "./hashes-json";
import { runExactStoreCommand } from "./exact-store-command";

function finalStoreName(lockHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(lockHash)) {
    throw new Error(`invalid pnpm lock hash for final store: ${lockHash}`);
  }
  return `pnpm-store-lock-${lockHash}`;
}

function lastOutputWord(stdout: string): string {
  return (
    String(stdout || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .pop() || ""
  );
}

function resolveNixStoreBin(env: NodeJS.ProcessEnv): string {
  return String(env.VBR_NIX_STORE_BIN || "").trim() || resolveToolPathSync("nix-store", env);
}

async function expectedFinalPnpmStorePath(opts: {
  repoRoot: string;
  importer: string;
  lockHash: string;
  expectedHash: string;
  timeoutMs: number;
}): Promise<string> {
  const nixEnv = withSanitizedInheritedNixConfig(envWithResolvedNixBin(process.env));
  const converted = await runExactStoreCommand({
    command: resolveToolPathSync("nix", nixEnv),
    echoStdout: false,
    label: `importer=${opts.importer} step=final-store-hash-convert`,
    cwd: opts.repoRoot,
    timeoutMs: opts.timeoutMs,
    env: nixEnv,
    args: ["hash", "convert", "--hash-algo", "sha256", "--to", "nix32", opts.expectedHash],
  });
  const nix32Hash = lastOutputWord(converted.stdout);
  const printed = await runExactStoreCommand({
    command: resolveNixStoreBin(nixEnv),
    echoStdout: false,
    label: `importer=${opts.importer} step=final-store-expected-path`,
    cwd: opts.repoRoot,
    timeoutMs: opts.timeoutMs,
    env: nixEnv,
    args: ["--print-fixed-path", "--recursive", "sha256", nix32Hash, finalStoreName(opts.lockHash)],
  });
  const expectedPath = lastOutputWord(printed.stdout);
  if (!expectedPath.startsWith("/nix/store/")) {
    throw new Error(`failed to resolve final pnpm store path for ${opts.importer}`);
  }
  return expectedPath;
}

export async function committedFinalStore(opts: {
  repoRoot: string;
  importer: string;
  lockHash: string;
  timeoutMs: number;
}): Promise<{ expectedHash: string; expectedPath: string }> {
  const normalized = opts.importer.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  const key =
    normalized && normalized !== "." && normalized !== "viberoots"
      ? `${normalized}/pnpm-lock.yaml`
      : "pnpm-lock.yaml";
  const owner = normalized === "viberoots" ? "viberoots" : hashOwnerForLockfile(key, opts.repoRoot);
  const expectedHash = await readNodeModulesHashForLockfile(key, {
    root: opts.repoRoot,
    owner,
  });
  if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(expectedHash)) {
    throw new Error(
      `${expectedHash ? "invalid" : "missing"} committed pnpm store hash for ${key}${expectedHash ? `: ${expectedHash}` : ""}\nrepair: run u`,
    );
  }
  return {
    expectedHash,
    expectedPath: await expectedFinalPnpmStorePath({ ...opts, expectedHash }),
  };
}
