import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import { makeFilteredFlakeRef } from "../../dev/filtered-flake";
import { REVIEWED_CONSUMER_NIXPKGS_23_11_LOCK } from "../../ci/artifact-reproducibility-consumer-lock";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";
import { derivePostCloneWorkspaceLock } from "../../lib/post-clone-workspace-lock";

let immutableInputPromise: Promise<string> | undefined;
const execFileAsync = promisify(execFile);

type FixtureFlakeLock = {
  nodes?: Record<string, Record<string, unknown>>;
  root?: string;
};

const sourceOwnedWorkspaceInputs = ["rust-overlay", "wasmtime-nixpkgs"] as const;

export async function immutableViberootsInput(viberootsRoot: string): Promise<string> {
  immutableInputPromise ??= (async () => {
    const artifactToolsRoot = canonicalArtifactToolsRoot(
      process.cwd(),
      String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
    );
    const env = buildCanonicalArtifactEnvironment(process.cwd(), { artifactToolsRoot });
    const filtered = await makeFilteredFlakeRef({
      workspaceRoot: viberootsRoot,
      attr: "viberoots",
      logPrefix: "[registry-extension]",
      env,
      selectorEnv: {},
    });
    try {
      return (await materializeFilteredViberootsSource(filtered.workspaceRoot, env)).storePath;
    } finally {
      await filtered.cleanup();
    }
  })();
  return immutableInputPromise;
}

export async function findViberootsRoot(): Promise<string> {
  for (const candidate of [path.join(process.cwd(), "viberoots"), process.cwd()]) {
    try {
      await fsp.access(path.join(candidate, "build-tools", "tools", "bin", "viberoots"));
      return candidate;
    } catch {}
  }
  throw new Error("could not find viberoots root");
}

export async function seedWorkspaceLockFromCommittedAuthority(workspace: string): Promise<void> {
  const repoRoot = await findViberootsRoot();
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--error-unmatch", "--", "flake.lock"],
    { cwd: repoRoot },
  );
  if (String(stdout).trim() !== "flake.lock") {
    throw new Error(`expected committed root flake.lock authority in ${repoRoot}`);
  }
  const committedLock = JSON.parse(
    await fsp.readFile(path.join(repoRoot, "flake.lock"), "utf8"),
  ) as FixtureFlakeLock;
  const workspaceLockPath = path.join(workspace, ".viberoots", "workspace", "flake.lock");
  const workspaceFlakeDir = path.dirname(workspaceLockPath);
  const workspaceLock = await fsp
    .readFile(workspaceLockPath, "utf8")
    .then((text) => JSON.parse(text) as FixtureFlakeLock)
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
  seedReviewedConsumerInputs(committedLock);
  if (workspaceLock) {
    preserveWorkspaceViberootsInput(committedLock, workspaceLock);
    await fsp.writeFile(workspaceLockPath, `${JSON.stringify(committedLock, null, 2)}\n`, "utf8");
    return;
  }
  const localInputPath = await declaredWorkspaceViberootsPath(workspaceFlakeDir);
  ensureCommittedViberootsInput(committedLock);
  await pinCommittedViberootsInput(committedLock, localInputPath);
  const sourceLockText = await fsp.readFile(path.join(localInputPath, "flake.lock"), "utf8");
  const derived = derivePostCloneWorkspaceLock({
    rootLockText: JSON.stringify(committedLock),
    workspaceFlakeDir,
    localInputPath,
    sourceLockText,
  });
  await fsp.writeFile(workspaceLockPath, `${JSON.stringify(derived, null, 2)}\n`, "utf8");
}

export async function writeFixtureFile(file: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, "utf8");
}

function ensureCommittedViberootsInput(committed: FixtureFlakeLock): void {
  committed.nodes ??= {};
  const rootName = String(committed.root || "root");
  const root = committed.nodes?.[rootName];
  if (!root) throw new Error("committed fixture lock is missing its root node");
  const inputs = ((root.inputs || {}) as Record<string, unknown>) || {};
  if (typeof inputs.viberoots === "string") return;
  root.inputs = {
    ...inputs,
    viberoots: "viberoots",
  };
  committed.nodes!.viberoots = {
    ...((committed.nodes?.viberoots || {}) as Record<string, unknown>),
    inputs: {
      buck2: ["buck2"],
      gomod2nix: ["gomod2nix"],
      nixpkgs: ["nixpkgs"],
    },
  };
}

function preserveWorkspaceViberootsInput(
  committed: FixtureFlakeLock,
  workspace: FixtureFlakeLock,
): void {
  const workspaceRootName = String(workspace.root || "root");
  const workspaceRoot = workspace.nodes?.[workspaceRootName];
  const workspaceInputs = workspaceRoot?.inputs as Record<string, unknown> | undefined;
  const viberootsRef = workspaceInputs?.viberoots;
  if (typeof viberootsRef !== "string") {
    throw new Error("workspace fixture lock is missing a viberoots input reference");
  }
  const committedRootName = String(committed.root || "root");
  const committedRoot = committed.nodes?.[committedRootName];
  if (!committedRoot) throw new Error("committed fixture lock is missing its root node");
  committedRoot.inputs = {
    ...((committedRoot.inputs || {}) as Record<string, unknown>),
    viberoots: viberootsRef,
  };
  for (const input of sourceOwnedWorkspaceInputs) {
    const inputRef = workspaceInputs[input];
    if (typeof inputRef === "string") {
      (committedRoot.inputs as Record<string, unknown>)[input] = inputRef;
      for (const nodeName of reachableLockNodes(workspace, inputRef)) {
        const node = workspace.nodes?.[nodeName];
        if (node) committed.nodes![nodeName] = node;
      }
    }
  }
  for (const nodeName of reachableLockNodes(workspace, viberootsRef)) {
    const node = workspace.nodes?.[nodeName];
    if (node) committed.nodes![nodeName] = node;
  }
}

async function pinCommittedViberootsInput(
  committed: FixtureFlakeLock,
  localInputPath: string,
): Promise<void> {
  ensureCommittedViberootsInput(committed);
  const rootName = String(committed.root || "root");
  const root = committed.nodes?.[rootName];
  const inputs = root?.inputs as Record<string, unknown> | undefined;
  const viberootsRef = inputs?.viberoots;
  if (!root || typeof viberootsRef !== "string") {
    throw new Error("committed fixture lock is missing its viberoots input reference");
  }
  if (!/^\/nix\/store\/[a-z0-9]{32}-source$/.test(localInputPath)) {
    throw new Error(
      `workspace fixture lock has no immutable viberoots path input: ${localInputPath}`,
    );
  }
  const { stdout } = await execFileAsync("nix", ["path-info", "--json", localInputPath], {
    maxBuffer: 1024 * 1024 * 4,
  });
  const parsed = JSON.parse(String(stdout || "{}")) as
    | Array<{ narHash?: string }>
    | Record<string, { narHash?: string }>;
  const pathInfo = Array.isArray(parsed) ? parsed[0] : parsed[localInputPath];
  const narHash = pathInfo?.narHash;
  if (typeof narHash !== "string" || !narHash.startsWith("sha256-")) {
    throw new Error(`immutable viberoots input has no Nix narHash: ${localInputPath}`);
  }
  const existing = committed.nodes?.[viberootsRef] || {};
  committed.nodes![viberootsRef] = {
    ...existing,
    locked: { type: "path", path: localInputPath, narHash },
    original: { type: "path", path: localInputPath },
    parent: [],
  };
}

async function declaredWorkspaceViberootsPath(workspaceFlakeDir: string): Promise<string> {
  const text = await fsp.readFile(path.join(workspaceFlakeDir, "flake.nix"), "utf8");
  const match = text.match(/\bviberoots\.url\s*=\s*"path:([^"]+)"/);
  const value = match?.[1] || "";
  if (!/^\/nix\/store\/[a-z0-9]{32}-source$/.test(value)) {
    throw new Error(`workspace fixture lock has no immutable viberoots path input: ${value}`);
  }
  return value;
}

function reachableLockNodes(lock: FixtureFlakeLock, root: string): string[] {
  const pending = [root];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const nodeName = pending.pop()!;
    if (seen.has(nodeName)) continue;
    seen.add(nodeName);
    const inputs = (lock.nodes?.[nodeName]?.inputs || {}) as Record<string, unknown>;
    for (const inputRef of Object.values(inputs)) {
      if (typeof inputRef === "string") pending.push(inputRef);
    }
  }
  return [...seen];
}

function seedReviewedConsumerInputs(lock: FixtureFlakeLock): void {
  const rootName = String(lock.root || "root");
  const root = lock.nodes?.[rootName];
  if (!root) throw new Error("committed fixture lock is missing its root node");
  root.inputs = {
    ...((root.inputs || {}) as Record<string, unknown>),
    nixpkgs_23_11: "nixpkgs_23_11",
  };
  lock.nodes!.nixpkgs_23_11 = structuredClone(REVIEWED_CONSUMER_NIXPKGS_23_11_LOCK);
}
