import * as fsp from "node:fs/promises";
import path from "node:path";
import { isCanonicalSha256SRI } from "./nix-sri";
import { assertCanonicalWorkspaceFlakeInputs } from "./workspace-flake-inputs";

type JsonObject = Record<string, unknown>;

export type PostCloneFlakeLock = {
  nodes: Record<string, JsonObject>;
  root: string;
  version: number;
};

const directWorkspaceInputs = [
  "buck2",
  "gomod2nix",
  "nixpkgs",
  "nixpkgs_23_11",
  "viberoots",
] as const;
const followedViberootsInputs = ["buck2", "gomod2nix", "nixpkgs"] as const;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseAuthoritativeRootLock(text: string): PostCloneFlakeLock {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("post-clone requires a valid committed root flake.lock");
  }
  if (!isObject(parsed) || parsed.version !== 7 || typeof parsed.root !== "string") {
    throw new Error("post-clone committed root flake.lock has an incompatible schema");
  }
  if (!isObject(parsed.nodes) || !isObject(parsed.nodes[parsed.root])) {
    throw new Error("post-clone committed root flake.lock has an incompatible root topology");
  }
  const rootInputs = parsed.nodes[parsed.root].inputs;
  if (!isObject(rootInputs)) {
    throw new Error("post-clone committed root flake.lock has incompatible direct inputs");
  }
  for (const input of directWorkspaceInputs) {
    const nodeName = rootInputs[input];
    const node = typeof nodeName === "string" ? parsed.nodes[nodeName] : null;
    const locked = isObject(node) && isObject(node.locked) ? node.locked : null;
    if (!locked || typeof locked.type !== "string" || !isCanonicalSha256SRI(locked.narHash)) {
      throw new Error(`post-clone committed root flake.lock has no locked ${input} input`);
    }
  }
  const viberoots = parsed.nodes[rootInputs.viberoots as string];
  const viberootsInputs = isObject(viberoots.inputs) ? viberoots.inputs : null;
  for (const input of followedViberootsInputs) {
    if (!viberootsInputs || !isDirectFollow(viberootsInputs[input], input)) {
      throw new Error(
        `post-clone committed root flake.lock has incompatible viberoots ${input} follow`,
      );
    }
  }
  const gomod2nix = parsed.nodes[rootInputs.gomod2nix as string];
  const gomod2nixInputs = isObject(gomod2nix.inputs) ? gomod2nix.inputs : null;
  if (!gomod2nixInputs || !isDirectFollow(gomod2nixInputs.nixpkgs, "nixpkgs")) {
    throw new Error(
      "post-clone committed root flake.lock has incompatible gomod2nix nixpkgs follow",
    );
  }
  return parsed as unknown as PostCloneFlakeLock;
}

function isDirectFollow(value: unknown, input: string): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === input;
}

function assertCanonicalLocalInput(opts: {
  workspaceFlakeDir: string;
  localInputPath: string;
}): void {
  const isFilteredCapture = opts.localInputPath === "./viberoots-flake-input";
  const isImmutableStoreSource = /^\/nix\/store\/[a-z0-9]{32}-source$/.test(opts.localInputPath);
  if (!isFilteredCapture && !isImmutableStoreSource) {
    throw new Error(`post-clone viberoots input is not canonical: ${opts.localInputPath}`);
  }
}

export function derivePostCloneWorkspaceLock(opts: {
  rootLockText: string;
  workspaceFlakeDir: string;
  localInputPath: string;
}): PostCloneFlakeLock {
  assertCanonicalLocalInput(opts);
  const lock = parseAuthoritativeRootLock(opts.rootLockText);
  const cloned = structuredClone(lock);
  const rootNode = cloned.nodes[cloned.root]!;
  const viberootsName = (rootNode.inputs as JsonObject).viberoots as string;
  const prior = cloned.nodes[viberootsName]!;
  const priorLocked = isObject(prior.locked) ? prior.locked : {};
  const storeNarHash = priorLocked.narHash;
  if (opts.localInputPath.startsWith("/nix/store/") && !isCanonicalSha256SRI(storeNarHash)) {
    throw new Error("post-clone committed root lock lacks the immutable viberoots narHash");
  }
  cloned.nodes[viberootsName] = {
    ...(isObject(prior.inputs) ? { inputs: structuredClone(prior.inputs) } : {}),
    locked: {
      ...(opts.localInputPath.startsWith("/nix/store/") && typeof storeNarHash === "string"
        ? { narHash: storeNarHash }
        : {}),
      path: opts.localInputPath,
      type: "path",
    },
    original: { path: opts.localInputPath, type: "path" },
    parent: [],
  };
  return cloned;
}

export async function writePostCloneWorkspaceLock(opts: {
  workspaceRoot: string;
  localInputPath: string;
}): Promise<void> {
  const rootLock = path.join(opts.workspaceRoot, "flake.lock");
  const workspaceFlakeDir = path.join(opts.workspaceRoot, ".viberoots", "workspace");
  const workspaceFlake = path.join(workspaceFlakeDir, "flake.nix");
  const inputRoot = path.resolve(workspaceFlakeDir, opts.localInputPath);
  const [rootLockText, workspaceFlakeText] = await Promise.all([
    fsp.readFile(rootLock, "utf8").catch(() => {
      throw new Error("post-clone requires an existing committed root flake.lock");
    }),
    fsp.readFile(workspaceFlake, "utf8"),
    fsp.access(path.join(inputRoot, "flake.nix")),
  ]);
  assertCanonicalWorkspaceFlakeInputs(workspaceFlakeText, `path:${opts.localInputPath}`);
  const lock = derivePostCloneWorkspaceLock({
    rootLockText,
    workspaceFlakeDir,
    localInputPath: opts.localInputPath,
  });
  const lockFile = path.join(workspaceFlakeDir, "flake.lock");
  const temporary = `${lockFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await fsp.rename(temporary, lockFile);
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => {});
  }
}
