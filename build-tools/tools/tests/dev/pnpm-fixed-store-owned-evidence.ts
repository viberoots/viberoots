import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  assertOwnedStorePathWithinKib,
  parseOwnedStorePathSize,
  runGuardedCommand,
} from "./pnpm-fixed-store-native-run";

export type OwnedPathInfo = {
  closureSize: number;
  narSize: number;
  references: string[];
  registrationTime: number;
};

export type OwnedRegistrationEvidence = {
  createdClosureKib: number;
  exactOwnedNarKib: number;
  registeredPaths: string[];
};

function ownedNamePattern(lockHash: string): RegExp {
  if (!/^[a-f0-9]{64}$/.test(lockHash)) throw new Error("invalid owned pnpm lock hash");
  return new RegExp(`^[a-z0-9]{32}-pnpm-store-lock-${lockHash}(?:\\.drv|\\.tmp)?$`);
}

export async function snapshotExactOwnedPnpmPaths(
  lockHash: string,
  storeDir = "/nix/store",
): Promise<Set<string>> {
  const pattern = ownedNamePattern(lockHash);
  return new Set(
    (await fsp.readdir(storeDir))
      .filter((entry) => pattern.test(entry))
      .map((entry) => path.join(storeDir, entry)),
  );
}

export function newlyRegisteredExactOwnedPaths(before: Set<string>, after: Set<string>): string[] {
  return [...after].filter((candidate) => !before.has(candidate)).sort();
}

export function parseOwnedPathInfo(output: string): Map<string, OwnedPathInfo> {
  const parsed = JSON.parse(output) as unknown;
  const entries = Array.isArray(parsed)
    ? parsed.map((entry) => [String((entry as { path?: unknown }).path || ""), entry] as const)
    : Object.entries((parsed || {}) as Record<string, unknown>);
  const records = new Map<string, OwnedPathInfo>();
  for (const [storePath, raw] of entries) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`invalid owned path-info record for ${storePath || "(missing path)"}`);
    }
    const value = raw as Partial<OwnedPathInfo>;
    const narSize = Number(value.narSize);
    const closureSize = Number(value.closureSize);
    const registrationTime = Number(value.registrationTime);
    const references = value.references;
    if (
      !/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/.test(storePath) ||
      !Number.isSafeInteger(narSize) ||
      narSize < 0 ||
      !Number.isSafeInteger(closureSize) ||
      closureSize < 0 ||
      !Number.isSafeInteger(registrationTime) ||
      registrationTime < 0 ||
      !Array.isArray(references) ||
      references.some((reference) => typeof reference !== "string")
    ) {
      throw new Error(`invalid owned path-info record for ${storePath || "(missing path)"}`);
    }
    records.set(storePath, { closureSize, narSize, references, registrationTime });
  }
  return records;
}

export function verifyOwnedRegistrationWindow(opts: {
  authorityRecords: Map<string, OwnedPathInfo>;
  exactCreatedRecords: Map<string, OwnedPathInfo>;
  exactCreatedPaths: string[];
  markerDerivation: string;
  markerOutput: string;
  maxKib: number;
  registrationStartedAt: number;
}): OwnedRegistrationEvidence {
  const output = opts.authorityRecords.get(opts.markerOutput);
  if (!output) throw new Error("owned authority omitted the marker output");
  if (output.references.length > 0) {
    throw new Error(`owned reconciled output retained references: ${output.references.join(", ")}`);
  }
  if (!opts.authorityRecords.has(opts.markerDerivation)) {
    throw new Error("owned authority omitted the marker derivation");
  }
  const unexpected = opts.exactCreatedPaths.filter(
    (storePath) => !opts.authorityRecords.has(storePath),
  );
  if (unexpected.length > 0) {
    throw new Error(`unexpected unreferenced owned pnpm paths: ${unexpected.join(", ")}`);
  }
  for (const storePath of opts.exactCreatedPaths) {
    if (!opts.exactCreatedRecords.has(storePath)) {
      throw new Error(`owned path registration evidence omitted ${storePath}`);
    }
  }
  const registered = [...opts.authorityRecords.entries()].filter(
    ([, record]) => record.registrationTime >= opts.registrationStartedAt,
  );
  const exactOwnedNar = opts.exactCreatedPaths.reduce(
    (total, storePath) => total + (opts.exactCreatedRecords.get(storePath)?.narSize || 0),
    0,
  );
  const createdClosure = registered.reduce((total, [, record]) => total + record.narSize, 0);
  const exactOwnedNarKib = Math.ceil(exactOwnedNar / 1024);
  const createdClosureKib = Math.ceil(createdClosure / 1024);
  const outputClosureKib = Math.ceil(output.closureSize / 1024);
  if (
    exactOwnedNarKib > opts.maxKib ||
    createdClosureKib > opts.maxKib ||
    outputClosureKib > opts.maxKib
  ) {
    throw new Error(
      `owned reconciliation registration exceeded ${opts.maxKib}KiB guard: exactNar=${exactOwnedNarKib}KiB createdClosure=${createdClosureKib}KiB outputClosure=${outputClosureKib}KiB`,
    );
  }
  return {
    createdClosureKib,
    exactOwnedNarKib,
    registeredPaths: registered.map(([storePath]) => storePath).sort(),
  };
}

export async function verifyNativePnpmOwnedEvidence(opts: {
  beforeOwnedPaths: Set<string>;
  cwd: string;
  env: NodeJS.ProcessEnv;
  fixtureRoot: string;
  lockHash: string;
  markerDerivation: string;
  markerOutput: string;
  maxKib: number;
  nix: string;
  peakFixtureKib: number;
  registrationStartedAt: number;
  sourceAuthority: string;
}): Promise<void> {
  const exactCreatedPaths = newlyRegisteredExactOwnedPaths(
    opts.beforeOwnedPaths,
    await snapshotExactOwnedPnpmPaths(opts.lockHash),
  );
  const runNix = async (args: string[]) => {
    const result = await runGuardedCommand(opts.nix, args, {
      cwd: opts.cwd,
      env: opts.env,
      fixtureRoot: opts.fixtureRoot,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const authorityRecords = parseOwnedPathInfo(
    await runNix([
      "path-info",
      "--recursive",
      "--closure-size",
      "--json",
      opts.markerDerivation,
      opts.markerOutput,
      opts.sourceAuthority,
    ]),
  );
  const unexpected = exactCreatedPaths.filter((storePath) => !authorityRecords.has(storePath));
  if (unexpected.length > 0) {
    throw new Error(`unexpected unreferenced owned pnpm paths: ${unexpected.join(", ")}`);
  }
  const exactCreatedRecords =
    exactCreatedPaths.length === 0
      ? new Map<string, OwnedPathInfo>()
      : parseOwnedPathInfo(
          await runNix(["path-info", "--closure-size", "--json", ...exactCreatedPaths]),
        );
  const registration = verifyOwnedRegistrationWindow({
    authorityRecords,
    exactCreatedRecords,
    exactCreatedPaths,
    markerDerivation: opts.markerDerivation,
    markerOutput: opts.markerOutput,
    maxKib: opts.maxKib,
    registrationStartedAt: opts.registrationStartedAt,
  });
  const size = parseOwnedStorePathSize(
    await runNix(["path-info", "--closure-size", "--json", opts.markerOutput]),
    opts.markerOutput,
  );
  assertOwnedStorePathWithinKib(opts.markerOutput, size, opts.maxKib);
  assert.throws(
    () =>
      assertOwnedStorePathWithinKib(
        opts.markerOutput,
        size,
        Math.max(0, Math.min(size.narKib, size.closureKib) - 1),
      ),
    /owned reconciled output exceeded/,
  );
  console.log(
    `[pnpm-native-owned-evidence] output=${opts.markerOutput} derivation=${opts.markerDerivation} nar_kib=${size.narKib} closure_kib=${size.closureKib} exact_owned_nar_kib=${registration.exactOwnedNarKib} created_closure_kib=${registration.createdClosureKib} registered_paths=${registration.registeredPaths.length} peak_fixture_kib=${opts.peakFixtureKib}`,
  );
}
