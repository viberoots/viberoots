export type FlakeLockSnapshot = Map<string, boolean>;

const FLAKE_LOCK_PATHS = [".viberoots/workspace/flake.lock", "flake.lock"];

async function hasHead(root: string): Promise<boolean> {
  const head = await $({ stdio: "pipe", cwd: root })`git rev-parse --verify --quiet HEAD`
    .nothrow()
    .quiet();
  return (head as any).exitCode === 0;
}

async function isTracked(root: string, lock: string): Promise<boolean> {
  const tracked = await $({ stdio: "pipe", cwd: root })`git ls-files --error-unmatch ${lock}`
    .nothrow()
    .quiet();
  return (tracked as any).exitCode === 0;
}

async function isClean(root: string, lock: string): Promise<boolean> {
  const worktree = await $({ stdio: "pipe", cwd: root })`git diff --quiet -- ${lock}`
    .nothrow()
    .quiet();
  const staged = await $({ stdio: "pipe", cwd: root })`git diff --cached --quiet -- ${lock}`
    .nothrow()
    .quiet();
  return (worktree as any).exitCode === 0 && (staged as any).exitCode === 0;
}

export async function captureFlakeLockSnapshot(root: string): Promise<FlakeLockSnapshot> {
  const snapshot: FlakeLockSnapshot = new Map();
  try {
    if (!(await hasHead(root))) return snapshot;
    for (const lock of FLAKE_LOCK_PATHS) {
      if (await isTracked(root, lock)) snapshot.set(lock, await isClean(root, lock));
    }
  } catch {}
  return snapshot;
}

export async function restoreFlakeLock(root: string, snapshot?: FlakeLockSnapshot): Promise<void> {
  try {
    const state = snapshot || (await captureFlakeLockSnapshot(root));
    if (state.size === 0) return;

    await $({ stdio: "pipe", cwd: root })`bash --noprofile --norc -c ${`
      set -euo pipefail
      for lock in "$@"; do
        git restore --worktree --staged "$lock"
      done
    `} bash ${Array.from(state)
      .filter(([, clean]) => clean)
      .map(([lock]) => lock)}`
      .nothrow()
      .quiet();
  } catch {}
}
