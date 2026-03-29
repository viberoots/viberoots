import "zx/globals";

function parseNum(s: string | undefined): number | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function defaultOrNonNegative(envVal: number | null, def: number): number {
  if (envVal == null) return def;
  if (!Number.isFinite(envVal)) return def;
  return Math.max(0, envVal);
}

async function freeGiBForPath(p: string): Promise<number | null> {
  try {
    const { stdout } = await $({ stdio: "pipe" })`df -Pk ${p} | tail -n1`;
    const line = String(stdout || "").trim();
    const toks = line.split(/\s+/);
    const availKB = Number(toks[3] || "0");
    return Math.max(0, Math.floor(availKB / 1024 / 1024));
  } catch {
    return null;
  }
}

export function shouldPreflightDevBuildStoreSpace(opts: {
  subcmd: string;
  restArgs: string[];
}): boolean {
  if (opts.subcmd !== "build") return false;
  return opts.restArgs.some((tok) => String(tok || "").trim() === "//...");
}

export async function ensureDevBuildStoreSpace(opts: {
  subcmd: string;
  restArgs: string[];
}): Promise<void> {
  if (!shouldPreflightDevBuildStoreSpace(opts)) return;

  const minFreeGiB = defaultOrNonNegative(parseNum(process.env.DEV_BUILD_LOW_SPACE_GB), 20);
  if (minFreeGiB <= 0) return;

  const freeGiB = await freeGiBForPath("/nix/store");
  if (freeGiB == null || freeGiB >= minFreeGiB) return;

  throw new Error(
    `[dev-build] refusing to start broad build: /nix/store free space below DEV_BUILD_LOW_SPACE_GB (${freeGiB}GiB < ${minFreeGiB}GiB). ` +
      `Free space first, or override DEV_BUILD_LOW_SPACE_GB if you intentionally want to proceed.`,
  );
}
