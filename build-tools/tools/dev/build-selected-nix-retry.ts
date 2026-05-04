// Helper that runs `nix build` for build-selected with one retry on transient nix-database
// errors (e.g., "path '/nix/store/...drv' is not valid", "database is locked"). These can
// surface when concurrent nix invocations contend for the local store; a short pause and
// retry absorbs the transient state without masking real build failures.

const TRANSIENT_NIX_PATTERNS = [/path '[^']+\.drv' is not valid/, /database is locked/];

export async function runNixBuildWithTransientRetry(opts: {
  runOnce: () => Promise<{ stdout: unknown; stderr: unknown; exitCode: unknown }>;
  retryDelayMs?: number;
}): Promise<{ stdout: unknown; stderr: unknown; exitCode: unknown }> {
  const delay = Math.max(0, opts.retryDelayMs ?? 750);
  const first = await opts.runOnce();
  if (Number(first.exitCode || 0) === 0) return first;
  if (!TRANSIENT_NIX_PATTERNS.some((pattern) => pattern.test(String(first.stderr || "")))) {
    return first;
  }
  console.error("[build-selected] transient nix store error; retrying once after " + delay + "ms");
  await new Promise((resolve) => setTimeout(resolve, delay));
  return await opts.runOnce();
}
