import process from "node:process";

function isSerialVerifyPass(name: string): boolean {
  return name.startsWith("isolated") || name === "resource-limited";
}

const DEFAULT_RESOURCE_LIMITED_START_DELAY_SECS = 900;
const BROAD_SHARED_DELAY_TARGET_MIN = 500;
const BROAD_RESOURCE_DELAY_TARGET_MIN = 50;

function parseNonNegativeInteger(raw: string | undefined): number | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

export function resourceLimitedStartDelaySeconds<
  T extends { name: string; targets: readonly unknown[] },
>(group: readonly T[], env: NodeJS.ProcessEnv = process.env): number {
  const resourceLimitedPass = group.find((pass) => pass.name === "resource-limited");
  const sharedPass = group.find((pass) => pass.name === "shared");
  if (!resourceLimitedPass || !sharedPass) return 0;

  const override = parseNonNegativeInteger(
    env.VBR_VERIFY_RESOURCE_LIMITED_START_DELAY_SECS ||
      env.VERIFY_RESOURCE_LIMITED_START_DELAY_SECS,
  );
  if (override != null) return override;

  if (
    sharedPass.targets.length >= BROAD_SHARED_DELAY_TARGET_MIN &&
    resourceLimitedPass.targets.length >= BROAD_RESOURCE_DELAY_TARGET_MIN
  ) {
    return DEFAULT_RESOURCE_LIMITED_START_DELAY_SECS;
  }
  return 0;
}

export function groupVerifyPassesForExecution<T extends { name: string }>(
  passes: readonly T[],
): T[][] {
  const groups: T[][] = [];
  const concurrent: T[] = [];
  for (const pass of passes) {
    if (isSerialVerifyPass(pass.name)) {
      if (concurrent.length > 0) {
        groups.push([...concurrent]);
        concurrent.length = 0;
      }
      groups.push([pass]);
      continue;
    }
    concurrent.push(pass);
  }
  if (concurrent.length > 0) groups.push(concurrent);
  return groups;
}

function passIsolationSuffix(passName: string): string {
  return (
    passName
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "pass"
  );
}

export function verifyPassIsolationDir(opts: {
  baseIso: string;
  passName: string;
  dedicated: boolean;
}): string {
  if (!opts.dedicated) return opts.baseIso;
  return `${opts.baseIso}-${passIsolationSuffix(opts.passName)}`;
}
