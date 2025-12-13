import "zx/globals";

export async function maybeAutoImpureFromUntrackedFiles(opts: {
  isCI: boolean;
  root: string;
  impure: boolean;
}): Promise<{ impure: boolean }> {
  if (opts.isCI || opts.impure) return { impure: opts.impure };
  try {
    const { stdout } = await $({
      stdio: "pipe",
      cwd: opts.root,
    })`git ls-files --others --exclude-standard`;
    const untracked = String(stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean);
    if (untracked.length === 0) return { impure: false };

    console.warn("[dev-build] Falling back to --impure due to untracked files:");
    for (const f of untracked.slice(0, 50)) console.warn(` - ${f}`);
    if (untracked.length > 50) console.warn(` ... and ${untracked.length - 50} more`);
    return { impure: true };
  } catch {}
  return { impure: false };
}
