import process from "node:process";

export function isSerialVerifyPass(name: string): boolean {
  return name === "isolated" || name === "isolated-bounded" || name.startsWith("isolated:");
}

function isSerialSidecarVerifyPass(name: string): boolean {
  return name === "enforcement";
}

const BROAD_SHARED_DELAY_TARGET_MIN = 500;
const BROAD_RESOURCE_DELAY_TARGET_MIN = 50;

function parseNonNegativeInteger(raw: string | undefined): number | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function explicitResourceLimitedStartDelaySeconds(env: NodeJS.ProcessEnv): number | null {
  return parseNonNegativeInteger(
    env.VBR_VERIFY_RESOURCE_LIMITED_START_DELAY_SECS ||
      env.VERIFY_RESOURCE_LIMITED_START_DELAY_SECS,
  );
}

export function resourceLimitedStartDelaySeconds<
  T extends { name: string; targets: readonly unknown[] },
>(group: readonly T[], env: NodeJS.ProcessEnv = process.env): number {
  const resourceLimitedPass = group.find((pass) => pass.name === "resource-limited");
  const sharedPass = group.find((pass) => pass.name === "shared");
  if (!resourceLimitedPass || !sharedPass) return 0;

  const override = explicitResourceLimitedStartDelaySeconds(env);
  if (override != null) return override;

  return 0;
}

function isBroadSharedResourceLimitedGroup<T extends { name: string; targets: readonly unknown[] }>(
  group: readonly T[],
): boolean {
  const resourceLimitedPass = group.find((pass) => pass.name === "resource-limited");
  const sharedPass = group.find((pass) => pass.name === "shared");
  return Boolean(
    resourceLimitedPass &&
      sharedPass &&
      sharedPass.targets.length >= BROAD_SHARED_DELAY_TARGET_MIN &&
      resourceLimitedPass.targets.length >= BROAD_RESOURCE_DELAY_TARGET_MIN,
  );
}

export function splitVerifyPassGroupForStagedStart<
  T extends { name: string; targets: readonly unknown[] },
>(
  group: readonly T[],
  env: NodeJS.ProcessEnv = process.env,
): {
  delaySeconds: number;
  immediatePasses: T[];
  delayedPasses: T[];
  waitForImmediatePassesBeforeDelayed: boolean;
} {
  const override = explicitResourceLimitedStartDelaySeconds(env);
  if (override === 0) {
    return {
      delaySeconds: 0,
      immediatePasses: [...group],
      delayedPasses: [],
      waitForImmediatePassesBeforeDelayed: false,
    };
  }
  const delaySeconds = resourceLimitedStartDelaySeconds(group, env);
  if (delaySeconds > 0) {
    return {
      delaySeconds,
      immediatePasses: group.filter((pass) => pass.name !== "resource-limited"),
      delayedPasses: group.filter((pass) => pass.name === "resource-limited"),
      waitForImmediatePassesBeforeDelayed: false,
    };
  }
  if (isBroadSharedResourceLimitedGroup(group)) {
    return {
      delaySeconds: 0,
      immediatePasses: group.filter((pass) => pass.name !== "shared"),
      delayedPasses: group.filter((pass) => pass.name === "shared"),
      waitForImmediatePassesBeforeDelayed: true,
    };
  }
  return {
    delaySeconds: 0,
    immediatePasses: [...group],
    delayedPasses: [],
    waitForImmediatePassesBeforeDelayed: false,
  };
}

export function groupVerifyPassesForExecution<T extends { name: string }>(
  passes: readonly T[],
): T[][] {
  const groups: T[][] = [];
  const concurrent: T[] = [];
  const serialSidecars: T[] = [];
  for (const pass of passes) {
    if (isSerialSidecarVerifyPass(pass.name)) {
      serialSidecars.push(pass);
    }
  }
  let serialSidecarsAttached = false;
  for (const pass of passes) {
    if (isSerialSidecarVerifyPass(pass.name)) continue;
    if (isSerialVerifyPass(pass.name)) {
      if (concurrent.length > 0) {
        groups.push([...concurrent]);
        concurrent.length = 0;
      }
      groups.push(serialSidecarsAttached ? [pass] : [pass, ...serialSidecars]);
      serialSidecarsAttached = true;
      continue;
    }
    concurrent.push(pass);
  }
  if (!serialSidecarsAttached) concurrent.push(...serialSidecars);
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
