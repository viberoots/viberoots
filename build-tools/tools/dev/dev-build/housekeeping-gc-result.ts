export const HOUSEKEEPING_HARD_MIN_FREE_BYTES = 8 * 1024 ** 3;

export function gcClientResultAccepted(opts: { afterBytes: number; exitCode: number }): boolean {
  if (opts.exitCode === 0) return true;
  if (opts.exitCode !== 124) return false;
  return opts.afterBytes >= HOUSEKEEPING_HARD_MIN_FREE_BYTES;
}
