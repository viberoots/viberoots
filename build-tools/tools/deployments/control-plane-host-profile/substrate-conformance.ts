#!/usr/bin/env zx-wrapper
import { promises as dns } from "node:dns";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getFlagList, getFlagStr } from "../../lib/cli";
import {
  checkCredentialPermissions,
  checkScratchDirectories,
} from "./substrate-conformance-filesystem";

export type CheckResult = { name: string; ok: boolean; detail: string };

export const SUPPORTED_SAAS_PLATFORMS = ["render", "northflank", "google-cloud-run"] as const;

export type SupportedSaasPlatform = (typeof SUPPORTED_SAAS_PLATFORMS)[number];

export type SubstrateConformanceOptions = {
  credentialDirectory: string;
  scratchDirectories: string[];
  expectedUid?: number;
  expectedGid?: number;
  platform?: SupportedSaasPlatform;
  outboundHosts?: string[];
  referenceTime?: Date;
  now?: Date;
  maxClockSkewMs?: number;
  procRoot?: string;
};

type SignalSource = {
  once(event: "SIGTERM" | "SIGINT", listener: (signal: NodeJS.Signals) => void): unknown;
};

export async function runSubstrateConformance(
  opts: SubstrateConformanceOptions,
): Promise<CheckResult[]> {
  const expectedOwner = expectedOwnerFromOptions(opts);
  const checks = await Promise.all([
    capture("platform-profile", () => checkPlatformProfile(opts.platform)),
    capture("linux-runtime", () => checkLinuxRuntime(opts.procRoot || "/proc")),
    capture("credential-files", () => checkCredentialPermissions(opts.credentialDirectory)),
    capture("scratch-mounts", () =>
      checkScratchDirectories(opts.scratchDirectories, expectedOwner),
    ),
    capture("dns", () => checkDns(opts.outboundHosts || ["github.com"])),
    capture("clock-skew", () =>
      checkClock(opts.referenceTime, opts.now || new Date(), opts.maxClockSkewMs || 30000),
    ),
  ]);
  return checks.flat();
}

export function assertSubstrateConformance(results: CheckResult[]): void {
  const failures = results.filter((result) => !result.ok);
  if (failures.length === 0) return;
  const details = failures.map((result) => `${result.name}: ${result.detail}`).join("; ");
  throw new Error(`substrate conformance failed: ${details}`);
}

async function checkLinuxRuntime(procRoot: string): Promise<CheckResult[]> {
  const cgroup = await readOptional(path.join(procRoot, "self/cgroup"));
  const status = await readOptional(path.join(procRoot, "self/status"));
  return [
    {
      name: "cgroups",
      ok: cgroup.trim().length > 0,
      detail:
        cgroup.trim().length > 0 ? "cgroup membership is visible" : "missing /proc cgroup data",
    },
    {
      name: "seccomp",
      ok: /^Seccomp:\s*[12]\b/m.test(status),
      detail: /^Seccomp:\s*[12]\b/m.test(status)
        ? "seccomp mode is active"
        : "seccomp mode is absent or disabled",
    },
  ];
}

function checkPlatformProfile(platform: SupportedSaasPlatform | undefined): CheckResult {
  if (!platform) return { name: "platform-profile", ok: true, detail: "generic OCI profile" };
  return {
    name: "platform-profile",
    ok: SUPPORTED_SAAS_PLATFORMS.includes(platform),
    detail: `selected SaaS OCI platform ${platform}`,
  };
}

async function checkDns(hosts: string[]): Promise<CheckResult> {
  for (const host of hosts) {
    await dns.lookup(host).catch((error) => {
      throw new Error(`${host} did not resolve: ${errorMessage(error)}`);
    });
  }
  return { name: "dns", ok: true, detail: `${hosts.length} hostnames resolved` };
}

function checkClock(reference: Date | undefined, now: Date, maxSkewMs: number): CheckResult {
  if (!reference) return { name: "clock-skew", ok: true, detail: "no reference time supplied" };
  const skew = Math.abs(now.getTime() - reference.getTime());
  return {
    name: "clock-skew",
    ok: skew <= maxSkewMs,
    detail: `skew ${skew}ms with max ${maxSkewMs}ms`,
  };
}

async function readOptional(file: string): Promise<string> {
  return await fsp.readFile(file, "utf8").catch(() => "");
}

async function capture(
  name: string,
  fn: () => Promise<CheckResult | CheckResult[]> | CheckResult,
): Promise<CheckResult | CheckResult[]> {
  try {
    return await fn();
  } catch (error) {
    return { name, ok: false, detail: errorMessage(error) };
  }
}

function parseDate(value: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid --reference-time: ${value}`);
  return date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function expectedOwnerFromOptions(
  opts: SubstrateConformanceOptions,
): Required<Pick<SubstrateConformanceOptions, "expectedUid" | "expectedGid">> {
  return {
    expectedUid: opts.expectedUid ?? process.getuid?.() ?? 10001,
    expectedGid: opts.expectedGid ?? process.getgid?.() ?? 10001,
  };
}

function parsePlatform(value: string): SupportedSaasPlatform | undefined {
  if (!value) return undefined;
  if (SUPPORTED_SAAS_PLATFORMS.includes(value as SupportedSaasPlatform)) {
    return value as SupportedSaasPlatform;
  }
  throw new Error(`unsupported --platform: ${value}`);
}

function parseIntegerFlag(name: string, defaultValue: number): number {
  const value = getFlagStr(name, "");
  if (!value) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`invalid --${name}: ${value}`);
  return parsed;
}

async function main(): Promise<void> {
  const signalMarker = getFlagStr("signal-marker", "");
  if (signalMarker) {
    await waitForGracefulSignal(signalMarker);
    return;
  }
  const results = await runSubstrateConformance({
    credentialDirectory: getFlagStr("credential-dir", "/run/deployment-control-plane/credentials"),
    scratchDirectories: getFlagList("scratch-dir"),
    expectedUid: parseIntegerFlag("expected-uid", process.getuid?.() ?? 10001),
    expectedGid: parseIntegerFlag("expected-gid", process.getgid?.() ?? 10001),
    platform: parsePlatform(getFlagStr("platform", "")),
    outboundHosts: getFlagList("outbound-host"),
    referenceTime: parseDate(getFlagStr("reference-time", "")),
  });
  for (const result of results) {
    console.log(`${result.ok ? "ok" : "fail"} ${result.name}: ${result.detail}`);
  }
  assertSubstrateConformance(results);
}

export async function waitForGracefulSignal(
  markerPath: string,
  signalSource: SignalSource = process,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const handler = async (signal: NodeJS.Signals) => {
      await fsp.mkdir(path.dirname(markerPath), { recursive: true });
      await fsp.writeFile(markerPath, `${signal}\n`, "utf8");
      resolve();
    };
    signalSource.once("SIGTERM", handler);
    signalSource.once("SIGINT", handler);
  });
}

function isMain(): boolean {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return invoked === fileURLToPath(import.meta.url);
}

if (isMain()) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}
