import fs from "node:fs";
import path from "node:path";

export const VIBEROOTS_CURRENT_REL = ".viberoots/current";
export const VIBEROOTS_WORKSPACE_REL = ".viberoots/workspace";

export type ViberootsSourceMode = "local" | "remote";
export type ViberootsCurrentStatus = "present" | "missing";
export type WorkspaceRoots = {
  workspaceRoot: string;
  viberootsRoot: string;
  viberootsCurrent: string;
  viberootsWorkspace: string;
  sourceMode: ViberootsSourceMode;
  currentStatus: ViberootsCurrentStatus;
  currentPointsToLiveCheckout: boolean;
};
export type ProjectScanContext = {
  workspaceRoot: string;
  projectsRoot: string;
  viberootsRoot: string;
  sourceMode: ViberootsSourceMode;
  buckTestTarget: string;
};

function canonicalPath(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return abs;
  }
}

function findFlakeRootSync(start: string): string | null {
  let dir = canonicalPath(start);
  for (;;) {
    const parent = path.dirname(dir);
    if (
      path.basename(dir) === "workspace" &&
      path.basename(parent) === ".viberoots" &&
      fs.existsSync(path.join(dir, "flake.nix"))
    ) {
      return path.dirname(parent);
    }
    if (
      path.basename(dir) === "viberoots" &&
      fs.existsSync(path.join(parent, VIBEROOTS_WORKSPACE_REL, "flake.nix"))
    ) {
      return parent;
    }
    if (fs.existsSync(path.join(dir, VIBEROOTS_WORKSPACE_REL, "flake.nix"))) return dir;
    if (fs.existsSync(path.join(dir, "flake.nix"))) return dir;
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveWorkspaceRootSync(
  start: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidates = [
    start,
    (env.WORKSPACE_ROOT || "").trim(),
    (env._VIBEROOTS_DEVSHELL_ROOT || "").trim(),
    (env.BUCK_TEST_SRC || "").trim(),
    (env.LIVE_ROOT || "").trim(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const root = findFlakeRootSync(candidate);
    if (root) return root;
  }
  return canonicalPath(candidates[0] || start);
}

function isNixStorePath(p: string): boolean {
  return canonicalPath(p).startsWith(`${path.sep}nix${path.sep}store${path.sep}`);
}

export function resolveWorkspaceRootsSync(opts?: {
  start?: string;
  env?: NodeJS.ProcessEnv;
}): WorkspaceRoots {
  const env = opts?.env || process.env;
  const workspaceRoot = resolveWorkspaceRootSync(opts?.start || process.cwd(), env);
  const viberootsCurrent = path.join(workspaceRoot, VIBEROOTS_CURRENT_REL);
  const viberootsWorkspace = path.join(workspaceRoot, VIBEROOTS_WORKSPACE_REL);
  const envRoot = (env.VIBEROOTS_ROOT || "").trim();
  const currentExists = fs.existsSync(viberootsCurrent);
  const viberootsRoot = envRoot
    ? canonicalPath(envRoot)
    : currentExists
      ? canonicalPath(viberootsCurrent)
      : workspaceRoot;
  const liveCheckouts = [workspaceRoot, path.join(workspaceRoot, "viberoots")].filter((p) =>
    fs.existsSync(p),
  );
  return {
    workspaceRoot,
    viberootsRoot,
    viberootsCurrent,
    viberootsWorkspace,
    sourceMode: isNixStorePath(viberootsRoot) ? "remote" : "local",
    currentStatus: currentExists ? "present" : "missing",
    currentPointsToLiveCheckout:
      currentExists &&
      liveCheckouts.some(
        (liveCheckout) => canonicalPath(viberootsCurrent) === canonicalPath(liveCheckout),
      ),
  };
}

export function resolveProjectScanContext(opts?: {
  start?: string;
  env?: NodeJS.ProcessEnv;
}): ProjectScanContext {
  const env = opts?.env || process.env;
  const roots = resolveWorkspaceRootsSync({ start: opts?.start, env });
  const workspaceRoot = canonicalPath(roots.workspaceRoot);
  const projectsRoot = canonicalPath(path.join(workspaceRoot, "projects"));
  if (!fs.existsSync(projectsRoot) || !projectsRoot.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`project scan root is unavailable or outside the workspace: ${projectsRoot}`);
  }
  const buckTestTarget = String(env.BUCK_TEST_TARGET || "").trim();
  if (!buckTestTarget.includes("workspace_buck//:project_enforcement_")) {
    throw new Error(
      `project scan requires generated workspace_buck execution evidence, got ${buckTestTarget || "<missing>"}`,
    );
  }
  return {
    workspaceRoot,
    projectsRoot,
    viberootsRoot: roots.viberootsRoot,
    sourceMode: roots.sourceMode,
    buckTestTarget,
  };
}
