export async function withInstallProgress<T>(
  label: string,
  promise: Promise<T>,
  opts: { outputMode?: string } = {},
): Promise<T> {
  const started = Date.now();
  const intervalsSec = [45, 120, 300, 600, 900];
  let index = 0;
  const outputMode = opts.outputMode || "quiet-unless-failed";
  const timer = setInterval(() => {
    const elapsed = Math.max(1, Math.floor((Date.now() - started) / 1000));
    const next = intervalsSec[index] ?? intervalsSec[intervalsSec.length - 1]!;
    if (elapsed < next) return;
    index += 1;
    process.stderr.write(
      `[install-deps] waiting on ${label} elapsed=${elapsed}s output=${outputMode}\n`,
    );
  }, 5_000);
  try {
    return await promise;
  } finally {
    clearInterval(timer);
  }
}
