import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { committedFinalStore } from "./exact-store";
import {
  commandOutput,
  finalPnpmStoreDerivationEvalArgs,
  finalPnpmStoreEvalArgs,
  finalStoreProbeEnv,
  realizedFinalStoreProbeTimeoutMs,
  resolveNixStoreBin,
} from "./realized-store-eval";
import { sha256File } from "./verified-marker";

const execFileAsync = promisify(execFile);
export {
  finalPnpmStoreDerivationEvalArgs,
  finalPnpmStoreEvalArgs,
  realizedFinalStoreProbeTimeoutMs,
} from "./realized-store-eval";

export async function evaluatePnpmStoreDerivationIdentity(opts: {
  repoRoot: string;
  flakeRef: string;
  attrPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const env = finalStoreProbeEnv(opts.env);
  const timeout = realizedFinalStoreProbeTimeoutMs(opts.env);
  const nixBin = resolveToolPathSync("nix", env);
  const flakeRef = opts.flakeRef.split("#", 1)[0] || opts.flakeRef;
  const evaluated = commandOutput(
    (
      await execFileAsync(nixBin, finalPnpmStoreDerivationEvalArgs(env, flakeRef, opts.attrPath), {
        cwd: opts.repoRoot,
        env,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
      })
    ).stdout,
  );
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\.drv$/.test(evaluated)) {
    throw new Error(
      `nix eval returned an invalid pnpm store derivation identity: ${evaluated || "(empty)"}`,
    );
  }
  return evaluated;
}

export type FinalPnpmStoreInspection =
  | { status: "realized"; path: string }
  | { status: "absent"; path: string }
  | { status: "invalid"; path: string };

export async function checkLiteralStorePathValidity(opts: {
  repoRoot: string;
  storePath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<"valid" | "invalid"> {
  const env = opts.env || finalStoreProbeEnv();
  const timeout = realizedFinalStoreProbeTimeoutMs(opts.env);
  const nixStoreBin = resolveNixStoreBin(env);
  const invalid = String(
    (
      await execFileAsync(nixStoreBin, ["--check-validity", "--print-invalid", opts.storePath], {
        cwd: opts.repoRoot,
        env,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
      })
    ).stdout || "",
  ).trim();
  if (invalid === "") return "valid";
  if (invalid === opts.storePath) return "invalid";
  throw new Error(
    `nix-store validity check returned unexpected output: ${invalid}; expected ${opts.storePath}`,
  );
}

export async function inspectFinalPnpmStore(opts: {
  repoRoot: string;
  commandCwd?: string;
  importer: string;
  flakeRef: string;
  attrPath: string;
  expectedPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FinalPnpmStoreInspection> {
  const env = finalStoreProbeEnv(opts.env);
  const timeout = realizedFinalStoreProbeTimeoutMs(opts.env);
  const nixBin = resolveToolPathSync("nix", env);
  const flakeRef = opts.flakeRef.split("#", 1)[0] || opts.flakeRef;
  const evaluated = commandOutput(
    (
      await execFileAsync(nixBin, finalPnpmStoreEvalArgs(env, flakeRef, opts.attrPath), {
        cwd: opts.commandCwd || opts.repoRoot,
        env,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
      })
    ).stdout,
  );
  if (!/^\/nix\/store\/[A-Za-z0-9._+?=-]+$/.test(evaluated)) {
    throw new Error(
      `nix eval returned an invalid final pnpm store path: ${evaluated || "(empty)"}`,
    );
  }
  if (evaluated !== opts.expectedPath) {
    throw new Error(
      `evaluated final pnpm store path does not match committed metadata for ${opts.importer}: ${evaluated}; expected ${opts.expectedPath}`,
    );
  }
  if (!fs.existsSync(evaluated)) {
    return { status: "absent", path: evaluated };
  }
  if (
    (await checkLiteralStorePathValidity({
      repoRoot: opts.repoRoot,
      storePath: evaluated,
      env,
    })) === "invalid"
  ) {
    return { status: "invalid", path: evaluated };
  }
  const validated = commandOutput(
    (
      await execFileAsync(nixBin, ["path-info", evaluated], {
        cwd: opts.repoRoot,
        env,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
      })
    ).stdout,
  );
  if (validated !== evaluated) {
    throw new Error(
      `nix path-info returned an unexpected final pnpm store path: ${validated || "(empty)"}; expected ${evaluated}`,
    );
  }
  return { status: "realized", path: evaluated };
}

export async function probeRealizedFinalPnpmStore(opts: {
  repoRoot: string;
  importer: string;
  flakeRef: string;
  attrPath: string;
  expectedPath: string;
}): Promise<string> {
  const inspected = await inspectFinalPnpmStore(opts);
  if (inspected.status !== "realized") {
    throw new Error(
      `final pnpm store is not realized for ${opts.importer}: ${inspected.path}\nno tracked files were modified\nrepair: run u`,
    );
  }
  return inspected.path;
}

export async function inspectCommittedFinalPnpmStore(opts: {
  repoRoot: string;
  commandCwd?: string;
  importer: string;
  flakeRef: string;
  attrPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FinalPnpmStoreInspection> {
  const committed = await committedFinalStore({
    repoRoot: opts.repoRoot,
    importer: opts.importer,
    lockHash: await sha256File(path.resolve(opts.repoRoot, opts.importer, "pnpm-lock.yaml")),
    timeoutMs: realizedFinalStoreProbeTimeoutMs(opts.env),
  });
  return await inspectFinalPnpmStore({ ...opts, expectedPath: committed.expectedPath });
}

export async function resolveFinalPnpmStore(opts: {
  repoRoot: string;
  commandCwd?: string;
  importer: string;
  flakeRef: string;
  attrPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ fixedStorePath: string; cleanup: () => Promise<void> }> {
  const inspected = await inspectCommittedFinalPnpmStore(opts);
  if (inspected.status !== "realized") {
    throw new Error(
      `final pnpm store is not realized for ${opts.importer}: ${inspected.path}\nno tracked files were modified\nrepair: run u`,
    );
  }
  return { fixedStorePath: inspected.path, cleanup: async () => {} };
}

export async function withResolvedFinalPnpmStore<T>(
  opts: { repoRoot: string; importer: string; flakeRef: string; attrPath: string },
  fn: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const resolved = await resolveFinalPnpmStore(opts);
  try {
    return await fn(finalStoreProbeEnv());
  } finally {
    await resolved.cleanup();
  }
}
