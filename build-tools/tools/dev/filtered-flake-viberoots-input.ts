import * as fsp from "node:fs/promises";
import path from "node:path";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { isCanonicalSha256SRI } from "../lib/nix-sri";
import { runCommand } from "./filtered-flake-command";

export interface MaterializedPathInput {
  storePath: string;
  locked: Record<string, unknown>;
}

type MaterializeInput = (
  inputPath: string,
  env?: NodeJS.ProcessEnv,
) => Promise<MaterializedPathInput>;

export async function repairSnapshotViberootsInput(
  opts: {
    snapDir: string;
    flakeDir: string;
    immutableInputRoot?: string;
    env?: NodeJS.ProcessEnv;
  },
  deps: {
    materializeInput?: MaterializeInput;
  } = {},
): Promise<string> {
  const snapshotRoot = path.join(opts.snapDir, "viberoots");
  const declaredRoot = String(opts.immutableInputRoot || "").trim();
  const immutableRoot = await immutableSource(declaredRoot);
  if (declaredRoot && !immutableRoot) {
    throw new Error(
      `[filtered-flake] declared viberoots input is not an immutable Nix-store source: ${declaredRoot}`,
    );
  }
  const inputRoot = immutableRoot || ((await hasFlake(snapshotRoot)) ? snapshotRoot : "");
  if (!inputRoot) return "";
  const materialized = await (deps.materializeInput || materializeFilteredViberootsSource)(
    inputRoot,
    opts.env,
  );
  assertImmutableSourcePath(materialized.storePath);
  for (const flakeDir of await snapshotWorkspaceFlakeDirs(opts.snapDir, opts.flakeDir)) {
    await rewriteViberootsInput(flakeDir, materialized);
  }
  return materialized.storePath;
}

async function snapshotWorkspaceFlakeDirs(snapDir: string, primary: string): Promise<string[]> {
  const candidates = [primary, snapDir, path.join(snapDir, ".viberoots", "workspace")];
  const present: string[] = [];
  for (const candidate of candidates) {
    if (present.includes(candidate) || !(await hasFlake(candidate))) continue;
    present.push(candidate);
  }
  return present;
}

async function hasFlake(root: string): Promise<boolean> {
  if (!root) return false;
  return await fsp
    .access(path.join(root, "flake.nix"))
    .then(() => true)
    .catch(() => false);
}

async function immutableSource(root: string): Promise<string> {
  if (!root) return "";
  const canonical = await fsp.realpath(root).catch(() => "");
  if (!/^\/nix\/store\/[a-z0-9]{32}-source$/.test(canonical) || !(await hasFlake(canonical))) {
    return "";
  }
  return canonical;
}

export async function materializeFilteredViberootsSource(
  inputPath: string,
  env?: NodeJS.ProcessEnv,
): Promise<MaterializedPathInput> {
  if (!env) {
    throw new Error(
      "materializeFilteredViberootsSource requires an explicit env; the caller must resolve authority at the public boundary.",
    );
  }
  const nixEnv = env;
  const nixBin = ensureNixStoreToolPathSync("nix", nixEnv);
  const canonical = await fsp.realpath(inputPath).catch(() => inputPath);
  const prefetched = await runCommand({
    command: nixBin,
    args: [
      "flake",
      "prefetch",
      "--json",
      "--no-use-registries",
      "--option",
      "flake-registry",
      "",
      `path:${canonical}`,
    ],
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
  let next = text.replace(
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
  // `parent` is meaningful for a relative path input. Keeping it after rewriting to
  // an absolute store path makes Nix consider the otherwise-coherent lock stale.
  delete node.parent;
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
