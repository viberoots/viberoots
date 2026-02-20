export async function restoreFlakeLock(root: string): Promise<void> {
  try {
    await $({ stdio: "pipe", cwd: root })`git restore --worktree --staged flake.lock`.nothrow();
  } catch {}
}
