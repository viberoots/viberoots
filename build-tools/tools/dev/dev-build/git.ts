export async function restoreFlakeLock(root: string): Promise<void> {
  try {
    const head = await $({ stdio: "pipe", cwd: root })`git rev-parse --verify --quiet HEAD`
      .nothrow()
      .quiet();
    if ((head as any).exitCode !== 0) return;

    await $({ stdio: "pipe", cwd: root })`bash --noprofile --norc -c ${`
      set -euo pipefail
      for lock in .viberoots/workspace/flake.lock flake.lock; do
        if git ls-files --error-unmatch "$lock" >/dev/null 2>&1; then
          git restore --worktree --staged "$lock"
        fi
      done
    `}`
      .nothrow()
      .quiet();
  } catch {}
}
