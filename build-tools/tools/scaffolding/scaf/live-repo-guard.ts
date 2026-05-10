import path from "node:path";

function hasValue(value: string | undefined): boolean {
  return String(value || "").trim() !== "";
}

function normalizeMaybePath(value: string | undefined): string {
  const raw = String(value || "").trim();
  return raw ? path.resolve(raw) : "";
}

function underManagedHarness(env: NodeJS.ProcessEnv): boolean {
  return [
    env.REPO_ROOT,
    env.WORKSPACE_ROOT,
    env.BUCK_TEST_SRC,
    env.BUCK_TEST_TARGET,
    env.BUCK_TARGET,
    env.VBR_VERIFY_LOCK_DIR,
    env.VBR_VERIFY_LOG_FILE,
    env.VERIFY_TIMEOUT_SECS,
    env.TEST_NIX_TIMEOUT_SECS,
  ].some(hasValue);
}

export function shouldRefuseLiveRepoScaffold(opts: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  repoRoot: string;
}): boolean {
  const env = opts.env || process.env;
  if (String(env.SCAF_ALLOW_LIVE_REPO || "").trim() === "1") return false;
  if (!underManagedHarness(env)) return false;

  const cwd = path.resolve(opts.cwd);
  const repoRoot = normalizeMaybePath(env.REPO_ROOT) || path.resolve(opts.repoRoot);
  const workspaceRoot =
    normalizeMaybePath(env.WORKSPACE_ROOT) || normalizeMaybePath(env.BUCK_TEST_SRC);

  if (workspaceRoot && workspaceRoot !== repoRoot && cwd === workspaceRoot) {
    return false;
  }
  if (
    String(env.VBR_RUN_IN_TEMP_REPO || "").trim() === "1" &&
    workspaceRoot &&
    cwd === workspaceRoot &&
    workspaceRoot === repoRoot
  ) {
    return false;
  }

  return cwd === repoRoot;
}

export function liveRepoScaffoldGuardMessage(): string {
  return [
    "error: refusing to scaffold in the live repo during tests/verify;",
    "ensure WORKSPACE_ROOT points to a temp workspace (use runInTemp),",
    "or set SCAF_ALLOW_LIVE_REPO=1 only for an intentional live checkout scaffold",
  ].join(" ");
}
