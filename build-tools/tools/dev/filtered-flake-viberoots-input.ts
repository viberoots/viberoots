import * as fsp from "node:fs/promises";
import path from "node:path";
import { envWithResolvedNixBin, resolveToolPathSync } from "../lib/tool-paths";
import { isCanonicalSha256SRI } from "../lib/nix-sri";
import { runCommand } from "./filtered-flake-command";

export interface MaterializedPathInput {
  storePath: string;
  locked: Record<string, unknown>;
}

type MaterializeInput = (inputPath: string) => Promise<MaterializedPathInput>;

export async function repairSnapshotViberootsInput(
  opts: {
    snapDir: string;
    flakeDir: string;
  },
  deps: {
    materializeInput?: MaterializeInput;
  } = {},
): Promise<string> {
  const snapshotRoot = path.join(opts.snapDir, "viberoots");
  try {
    await fsp.access(path.join(snapshotRoot, "flake.nix"));
  } catch {
    return "";
  }
  const materialized = await (deps.materializeInput || materializeFilteredViberootsSource)(
    snapshotRoot,
  );
  assertImmutableSourcePath(materialized.storePath);
  await rewriteViberootsInput(opts.flakeDir, materialized);
  return materialized.storePath;
}

export async function materializeFilteredViberootsSource(
  inputPath: string,
): Promise<MaterializedPathInput> {
  const nixEnv = envWithResolvedNixBin(process.env);
  const nixBin = resolveToolPathSync("nix", nixEnv);
  const canonical = await fsp.realpath(inputPath).catch(() => inputPath);
  const prefetched = await runCommand({
    command: nixBin,
    args: ["flake", "prefetch", "--json", `path:${canonical}`],
    env: nixEnv,
    allowFailure: true,
  });
  if (prefetched.exitCode !== 0) {
    throw new Error(
      `[filtered-flake] failed to materialize filtered viberoots input: ${String(prefetched.stderr || "").trim()}`,
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(String(prefetched.stdout || "{}")) as Record<string, unknown>;
  } catch {
    throw new Error("[filtered-flake] viberoots prefetch returned invalid JSON");
  }
  const storePath = typeof parsed.storePath === "string" ? parsed.storePath : "";
  const locked = isRecord(parsed.locked) ? parsed.locked : {};
  const narHash = typeof locked.narHash === "string" ? locked.narHash : "";
  assertImmutableSourcePath(storePath);
  if (!isCanonicalSha256SRI(narHash)) {
    throw new Error("[filtered-flake] viberoots prefetch did not return a locked narHash");
  }
  await fsp.access(path.join(storePath, "flake.nix"));
  return {
    storePath,
    locked: {
      ...(typeof locked.lastModified === "number" ? { lastModified: locked.lastModified } : {}),
      narHash,
      path: storePath,
      type: "path",
    },
  };
}

async function rewriteViberootsInput(
  flakeDir: string,
  materialized: MaterializedPathInput,
): Promise<void> {
  const { storePath, locked } = materialized;
  const flakePath = path.join(flakeDir, "flake.nix");
  const text = await fsp.readFile(flakePath, "utf8");
  const next = text.replace(
    /(\bviberoots\.url\s*=\s*)"[^"]*"/,
    (_match, prefix: string) => `${prefix}"path:${storePath}"`,
  );
  if (!next.includes(`viberoots.url = "path:${storePath}"`)) {
    throw new Error(`[filtered-flake] snapshot flake does not declare inputs.viberoots.url`);
  }
  if (next !== text) await fsp.writeFile(flakePath, next, "utf8");
  const lockPath = path.join(flakeDir, "flake.lock");
  const lock = JSON.parse(await fsp.readFile(lockPath, "utf8")) as {
    nodes?: Record<string, Record<string, unknown>>;
  };
  const node = lock.nodes?.viberoots;
  if (!node) throw new Error(`[filtered-flake] snapshot lock does not contain viberoots input`);
  node.locked = { ...locked, path: storePath };
  node.original = { type: "path", path: storePath };
  await fsp.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

function assertImmutableSourcePath(storePath: string): void {
  if (!/^\/nix\/store\/[a-z0-9]{32}-source$/.test(storePath)) {
    throw new Error(
      `[filtered-flake] expected immutable filtered viberoots store source, got: ${storePath || "<empty>"}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
