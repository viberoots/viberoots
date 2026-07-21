#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  assertRemoteBuilderSmokeEvidence,
  buildRemoteBuilderSmokeEvidence,
  parseRemoteBuilderSmokeEvidence,
  remoteCiToolsPathEnv,
} from "../../remote-exec/nix-remote-builder-config";
import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "../../lib/artifact-nix-policy";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";

const identity = "reviewed:linux-builder-primary";
const assertion = {
  schema: "viberoots.remote-builder-policy-assertion.v1",
  supportedSystem: "x86_64-linux",
  builder: { policy: "inherit_config", identity },
  effectivePolicy: {
    inspection: "builder-reported",
    sandbox: true,
    sandboxFallback: false,
    hostPaths: [],
    multiUser: "daemon",
    substituters: [...REVIEWED_SUBSTITUTERS],
    publicKeys: [...REVIEWED_PUBLIC_KEYS],
  },
};
const authorities = {
  registryStorePath: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-reviewed-builders/registry.json",
  policyAssertionStorePath: "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-builder-policy",
  probeFlakeStorePath: "/nix/store/cccccccccccccccccccccccccccccccc-remote-probe-flake",
};

function evidence() {
  return buildRemoteBuilderSmokeEvidence(structuredClone(assertion), {
    policy: "inherit_config",
    reviewedBuilderIdentities: [identity],
    authorities,
  });
}

function rejects(change: (value: any) => void, pattern: RegExp) {
  const value: any = structuredClone(evidence());
  change(value);
  assert.throws(() => assertRemoteBuilderSmokeEvidence(value), pattern);
}

test("remote builder smoke emits strict v2 evidence for every supported system", () => {
  const x86 = evidence();
  assert.equal(x86.schema, "viberoots.remote-builder-smoke-evidence.v2");
  assert.equal(x86.probes.store.bounded, true);
  const arm = buildRemoteBuilderSmokeEvidence(
    { ...structuredClone(assertion), supportedSystem: "aarch64-linux" },
    { policy: "inherit_config", reviewedBuilderIdentities: [identity], authorities },
  );
  assert.equal(arm.supportedSystem, "aarch64-linux");
  assert.deepEqual(parseRemoteBuilderSmokeEvidence(JSON.stringify(arm)), arm);
  const darwin = buildRemoteBuilderSmokeEvidence(
    { ...structuredClone(assertion), supportedSystem: "aarch64-darwin" },
    {
      policy: "inherit_config",
      expectedSystem: "aarch64-darwin",
      reviewedBuilderIdentities: [identity],
      authorities,
    },
  );
  assert.equal(darwin.supportedSystem, "aarch64-darwin");
});

test("remote builder smoke evidence is bound to the active execution system", () => {
  assert.throws(
    () =>
      assertRemoteBuilderSmokeEvidence(evidence(), {
        policy: "inherit_config",
        expectedSystem: "aarch64-linux",
      }),
    /does not match active execution system/,
  );
});

test("remote builder smoke rejects missing or failed mandatory probes", () => {
  rejects((value) => delete value.probes.store, /invalid probes fields/);
  rejects((value) => (value.probes.ordinaryHostRead.result = "passed"), /ordinaryHostRead/);
  rejects((value) => (value.probes.ordinaryNetwork.bounded = false), /ordinaryNetwork/);
  rejects((value) => (value.probes.fixedOutputCorrectHash.owned = false), /fixedOutputCorrectHash/);
  rejects((value) => delete value.probes.fixedOutputWrongHash, /invalid probes fields/);
});

test("remote builder smoke rejects non-hermetic effective builder policy", () => {
  rejects((value) => (value.effectivePolicy.sandbox = false), /sandbox=true/);
  rejects((value) => (value.effectivePolicy.sandboxFallback = true), /sandbox-fallback=false/);
  rejects((value) => value.effectivePolicy.hostPaths.push("/host"), /host sandbox paths/);
  rejects((value) => (value.effectivePolicy.multiUser = "direct"), /daemon store/);
  rejects(
    (value) => (value.effectivePolicy.substituters = ["https://evil.invalid"]),
    /substituters/,
  );
  rejects((value) => (value.effectivePolicy.publicKeys = ["evil:key"]), /public keys/);
  rejects((value) => (value.effectivePolicy.inspection = "client-reported"), /builder-reported/);
});

test("remote builder smoke rejects stale schema, policy, system, and builder identity", () => {
  rejects((value) => (value.schema = "v1"), /passed v2/);
  rejects((value) => (value.supportedSystem = "riscv64-linux"), /supported Nix system/);
  rejects((value) => (value.builder.identity = "reviewed:"), /nonempty reviewed/);
  rejects((value) => (value.authorities.probeFlakeStorePath = "/tmp/probe"), /probe flake/);
  assert.throws(
    () =>
      assertRemoteBuilderSmokeEvidence(evidence(), {
        reviewedBuilderIdentities: ["reviewed:different"],
      }),
    /unreviewed builder identity/,
  );
  assert.throws(
    () => assertRemoteBuilderSmokeEvidence(evidence(), { policy: "force_builders_file" }),
    /does not match action policy/,
  );
});

test("remote builder smoke orchestration is bounded and success-report-last", () => {
  const source = fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../remote-exec/nix-remote-builder-smoke.ts",
    ),
    "utf8",
  );
  const probes = fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../remote-exec/nix-remote-builder-probes.ts",
    ),
    "utf8",
  );
  assert.match(source, /runRemoteBuilderProbes/);
  assert.match(probes, /runBoundedArtifactCommand/);
  assert.match(source, /await fs\.rm\(reportPath/);
  assert.match(source, /await runRemoteBuilderProbes[\s\S]*buildRemoteBuilderSmokeEvidence/);
  assert.match(source, /await atomicWrite\(reportPath/);
  assert.doesNotMatch(source, /\.nothrow\(|\$`|NIX_CONFIG/);
  assert.doesNotMatch(probes, /\.nothrow\(|\$`|NIX_CONFIG/);
  assert.match(source, /"store", "cat", "--store", opts\.builderUri, policyStorePath/);
  assert.match(source, /viberoots\.reviewed-remote-builders\.v1/);
  assert.match(source, /--reviewed-builders must be the canonical immutable registry/);
  assert.match(source, /--builder-uri does not match the reviewed builder registry/);
  assert.match(source, /--probe-flake does not match the reviewed builder registry/);
  assert.doesNotMatch(source, /builder-policy-report/);
  for (const name of [
    "ordinary-host-read",
    "ordinary-network",
    "fixed-output-correct-hash",
    "fixed-output-wrong-hash",
  ]) {
    assert.match(probes, new RegExp(name));
  }
});

test("remote builder smoke restricts tools to the Nix artifact environment", () => {
  const tools = canonicalArtifactToolsRoot(process.cwd());
  const env = remoteCiToolsPathEnv(tools, {
    PATH: "/bin",
    HOME: "/host/home",
  });
  assert.equal(env.PATH, `${tools}/bin`);
  assert.notEqual(env.HOME, "/host/home");
  assert.equal(env.TZ, "UTC");
  assert.throws(() => remoteCiToolsPathEnv("", { PATH: "/bin" }), /required/);
  assert.throws(() => remoteCiToolsPathEnv("relative-tools", {}), /remote-ci-tools/);
});
