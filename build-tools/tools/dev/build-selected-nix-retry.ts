// Helper that runs `nix build` for build-selected with a few retries on transient nix-database
// errors (e.g., "path '/nix/store/...drv' is not valid", "database is locked"). These can
// surface when concurrent nix invocations contend for the local store; a short pause and
// retry absorbs the transient state without masking real build failures.

const TRANSIENT_NIX_PATTERNS = [/path '[^']+\.drv' is not valid/, /database is locked/];

export async function runNixBuildWithTransientRetry(opts: {
  runOnce: () => Promise<{ stdout: unknown; stderr: unknown; exitCode: unknown }>;
  retryDelayMs?: number;
  maxRetries?: number;
}): Promise<{ stdout: unknown; stderr: unknown; exitCode: unknown }> {
  const delay = Math.max(0, opts.retryDelayMs ?? 750);
  const maxRetries = Math.max(0, opts.maxRetries ?? 3);
  let attempt = await opts.runOnce();
  for (let retry = 1; retry <= maxRetries; retry += 1) {
    if (Number(attempt.exitCode || 0) === 0) return attempt;
    if (!TRANSIENT_NIX_PATTERNS.some((pattern) => pattern.test(String(attempt.stderr || "")))) {
      return attempt;
    }
    console.error(
      `[build-selected] transient nix store error; retrying ${retry}/${maxRetries} after ${delay}ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
    attempt = await opts.runOnce();
  }
  return attempt;
}
