#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  assertSubstrateConformance,
  runSubstrateConformance,
  SUPPORTED_SAAS_PLATFORMS,
  type SupportedSaasPlatform,
  waitForGracefulSignal,
} from "../../deployments/control-plane-host-profile/substrate-conformance";
import { runInScratchTemp } from "../lib/test-helpers";

async function writeProcFixture(root: string, seccomp = "2") {
  const self = path.join(root, "self");
  await fsp.mkdir(self, { recursive: true });
  await fsp.writeFile(path.join(self, "cgroup"), "0::/\n", "utf8");
  await fsp.writeFile(path.join(self, "status"), `Name:\tnode\nSeccomp:\t${seccomp}\n`, "utf8");
}

async function writeConformanceTree(root: string, mode = 0o400) {
  const procRoot = path.join(root, "proc");
  const credentials = path.join(root, "credentials");
  const scratch = [
    path.join(root, "records"),
    path.join(root, "artifacts"),
    path.join(root, "runtime"),
  ];
  await writeProcFixture(procRoot);
  await fsp.mkdir(credentials, { recursive: true });
  await fsp.chmod(credentials, 0o700);
  await fsp.writeFile(path.join(credentials, "control-plane-token"), "token\n", "utf8");
  await fsp.chmod(path.join(credentials, "control-plane-token"), mode);
  for (const directory of scratch) {
    await fsp.mkdir(directory, { recursive: true });
    await fsp.chmod(directory, 0o700);
  }
  const owner = await fsp.stat(scratch[0]!);
  return { procRoot, credentials, scratch, owner };
}

test("substrate conformance accepts cgroups, seccomp, credentials, scratch, DNS, and clock", async () => {
  await runInScratchTemp("control-plane-substrate-conformance", async (tmp) => {
    const fixture = await writeConformanceTree(tmp);
    const results = await runSubstrateConformance({
      credentialDirectory: fixture.credentials,
      scratchDirectories: fixture.scratch,
      expectedUid: fixture.owner.uid,
      expectedGid: fixture.owner.gid,
      platform: "render",
      outboundHosts: ["localhost"],
      procRoot: fixture.procRoot,
      referenceTime: new Date("2026-01-01T00:00:00.000Z"),
      now: new Date("2026-01-01T00:00:01.000Z"),
      maxClockSkewMs: 5000,
    });
    assertSubstrateConformance(results);
    assert.deepEqual(
      results.map((result) => [result.name, result.ok]),
      [
        ["platform-profile", true],
        ["cgroups", true],
        ["seccomp", true],
        ["credential-files", true],
        ["scratch-mounts", true],
        ["dns", true],
        ["clock-skew", true],
      ],
    );
  });
});

test("substrate conformance rejects unsafe filesystem and scratch ownership", async () => {
  await runInScratchTemp("control-plane-substrate-filesystem", async (tmp) => {
    const fixture = await writeConformanceTree(tmp);
    await fsp.chmod(fixture.scratch[0]!, 0o777);
    let results = await runSubstrateConformance({
      credentialDirectory: fixture.credentials,
      scratchDirectories: fixture.scratch,
      expectedUid: fixture.owner.uid,
      expectedGid: fixture.owner.gid,
      outboundHosts: ["localhost"],
      procRoot: fixture.procRoot,
    });
    assert.throws(() => assertSubstrateConformance(results), /unsafe mode bits/);
    await fsp.chmod(fixture.scratch[0]!, 0o700);
    results = await runSubstrateConformance({
      credentialDirectory: fixture.credentials,
      scratchDirectories: fixture.scratch,
      expectedUid: fixture.owner.uid + 1,
      expectedGid: fixture.owner.gid,
      outboundHosts: ["localhost"],
      procRoot: fixture.procRoot,
    });
    assert.throws(() => assertSubstrateConformance(results), /owner .* expected/);
  });
});

test("substrate conformance rejects env-var-only style credential mounts", async () => {
  await runInScratchTemp("control-plane-substrate-conformance-env-only", async (tmp) => {
    const fixture = await writeConformanceTree(tmp, 0o444);
    const results = await runSubstrateConformance({
      credentialDirectory: fixture.credentials,
      scratchDirectories: fixture.scratch,
      outboundHosts: ["localhost"],
      procRoot: fixture.procRoot,
    });
    assert.throws(() => assertSubstrateConformance(results), /group\/world permission bits/);
  });
});

test("substrate conformance signal canary records graceful shutdown signal", async () => {
  await runInScratchTemp("control-plane-substrate-signal", async (tmp) => {
    const marker = path.join(tmp, "signal-marker");
    const signalSource = new EventEmitter();
    const pending = waitForGracefulSignal(marker, signalSource);
    signalSource.emit("SIGTERM", "SIGTERM");
    await pending;
    assert.equal(await fsp.readFile(marker, "utf8"), "SIGTERM\n");
  });
});

for (const platform of SUPPORTED_SAAS_PLATFORMS) {
  test(`live-gated ${platform} SaaS OCI substrate conformance`, async (t) => {
    const envPrefix = `VBR_CONTROL_PLANE_LIVE_${platformEnvName(platform)}_SUBSTRATE`;
    if (process.env[envPrefix] !== "1") {
      t.skip(`set ${envPrefix}=1 inside the candidate ${platform} substrate`);
      return;
    }
    const results = await runLivePlatformConformance(platform, envPrefix);
    assertSubstrateConformance(results);
  });
}

async function runLivePlatformConformance(platform: SupportedSaasPlatform, envPrefix: string) {
  const results = await runSubstrateConformance({
    credentialDirectory: String(process.env[`${envPrefix}_CREDENTIAL_DIR`] || "").trim(),
    scratchDirectories: csvEnv(`${envPrefix}_SCRATCH_DIRS`),
    expectedUid: numberEnv(`${envPrefix}_EXPECTED_UID`),
    expectedGid: numberEnv(`${envPrefix}_EXPECTED_GID`),
    platform,
    outboundHosts: csvEnv(`${envPrefix}_OUTBOUND_HOSTS`, "github.com"),
    referenceTime: process.env[`${envPrefix}_REFERENCE_TIME`]
      ? new Date(process.env[`${envPrefix}_REFERENCE_TIME`]!)
      : undefined,
  });
  return results;
}

function csvEnv(name: string, fallback = "") {
  return String(process.env[name] || fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function numberEnv(name: string): number | undefined {
  const value = String(process.env[name] || "").trim();
  return value ? Number(value) : undefined;
}

function platformEnvName(platform: SupportedSaasPlatform): string {
  return platform.toUpperCase().replace(/-/g, "_");
}
