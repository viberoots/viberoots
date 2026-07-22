#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assertTrustedDaemonStoreInfo } from "../../remote-exec/nix-remote-builder-attest";
import {
  canonicalJson,
  installReviewedSshHostAuthority,
  parseRemoteBuilderEndpoint,
  parseRemoteBuilderTransportFile,
  parseReviewedRemoteBuilders,
} from "../../remote-exec/remote-builder-authority";

const endpoint = {
  schema: "viberoots.remote-builder-endpoint.v2" as const,
  protocol: "ssh-ng" as const,
  host: "builder.example.com",
  port: 22,
  user: "nix",
  hostKey: {
    algorithm: "ssh-ed25519" as const,
    publicKey: "AAAAC3NzaC1lZDI1NTE5AAAAIHZs0h63XqwPCOe+Hw1bExE5FU8XeADMOijgI1J0/R9q",
    fingerprint: "SHA256:hKX2WRrp0EaRIfb000oRGYXwjSTqwnV9h8n/vb2P9JA" as const,
  },
};

test("reviewed endpoint and registry contain no credential transport", () => {
  assert.deepEqual(parseRemoteBuilderEndpoint(endpoint), endpoint);
  assert.throws(
    () => parseRemoteBuilderEndpoint({ ...endpoint, credential: "inline-secret" }),
    /invalid fields/,
  );
  const registry = {
    schema: "viberoots.reviewed-remote-builders.v3",
    evidenceStore: {
      schema: "viberoots.reproducibility-evidence-store.v1",
      storeUri: "s3://reviewed-evidence/reproducibility",
      signatures: "required",
    },
    builders: [
      {
        identity: "reviewed:primary",
        endpoint,
        supportedSystem: "x86_64-linux",
        policyStorePath: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-policy",
        probeFlakeStorePath: "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-probes",
      },
    ],
  };
  assert.deepEqual(parseReviewedRemoteBuilders(registry), registry);
  assert.throws(
    () =>
      parseRemoteBuilderEndpoint({
        ...endpoint,
        hostKey: { ...endpoint.hostKey, fingerprint: "SHA256:wrong" },
      }),
    /fingerprint is invalid/,
  );
  assert.throws(
    () =>
      parseReviewedRemoteBuilders({
        ...registry,
        evidenceStore: { ...registry.evidenceStore, storeUri: "s3://user:secret@bucket/path" },
      }),
    /credential-free signed S3/,
  );
  assert.throws(
    () =>
      parseReviewedRemoteBuilders({
        ...registry,
        evidenceStore: {
          ...registry.evidenceStore,
          storeUri: "https://reviewed-evidence.example/reproducibility",
        },
      }),
    /credential-free signed S3/,
  );
  assert.throws(
    () =>
      parseReviewedRemoteBuilders({
        ...registry,
        builders: [{ ...registry.builders[0], supportedSystem: "local-system" }],
      }),
    /supportedSystem is invalid/,
  );
  assert.throws(
    () =>
      parseReviewedRemoteBuilders({
        ...registry,
        builders: [
          registry.builders[0],
          {
            ...registry.builders[0],
            identity: "reviewed:secondary",
            policyStorePath: "/nix/store/cccccccccccccccccccccccccccccccc-policy",
          },
        ],
      }),
    /share one remote daemon authority/,
  );
  assert.throws(() => parseReviewedRemoteBuilders({ ...registry, schema: "v2" }), /requires v3/);
});

test("builder attestation requires a trusted daemon store", () => {
  assert.doesNotThrow(() => assertTrustedDaemonStoreInfo({ url: "daemon", trusted: true }));
  assert.throws(
    () => assertTrustedDaemonStoreInfo({ url: "local", trusted: true }),
    /trusted builder-local daemon/,
  );
  assert.throws(
    () => assertTrustedDaemonStoreInfo({ url: "daemon", trusted: false }),
    /trusted builder-local daemon/,
  );
});

test("runtime SSH transport is nofollow mode-0600 and endpoint-bound", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "remote-builder-transport-"));
  const transport = path.join(root, "transport.json");
  const key = path.join(root, "key");
  fs.writeFileSync(key, "fixture", { mode: 0o600 });
  fs.writeFileSync(
    transport,
    JSON.stringify({
      schema: "viberoots.remote-builder-ssh-transport.v2",
      builderUri: `ssh-ng://nix@builder.example.com?ssh-key=${encodeURIComponent(key)}`,
    }),
    { mode: 0o600 },
  );
  assert.match(parseRemoteBuilderTransportFile(transport, endpoint).builderUri, /ssh-key/);
  fs.chmodSync(transport, 0o644);
  assert.throws(() => parseRemoteBuilderTransportFile(transport, endpoint), /mode-0600/);
  fs.chmodSync(transport, 0o600);
  assert.throws(
    () => parseRemoteBuilderTransportFile(transport, { ...endpoint, host: "other.example.com" }),
    /does not match/,
  );
  for (const suffix of [
    `/unreviewed?ssh-key=${encodeURIComponent(key)}`,
    `?ssh-key=${encodeURIComponent(key)}#unreviewed`,
    `?ssh-key=${encodeURIComponent(key)}&compress=true`,
  ]) {
    fs.writeFileSync(
      transport,
      JSON.stringify({
        schema: "viberoots.remote-builder-ssh-transport.v2",
        builderUri: `ssh-ng://nix@builder.example.com${suffix}`,
      }),
      { mode: 0o600 },
    );
    assert.throws(() => parseRemoteBuilderTransportFile(transport, endpoint), /exact|only one/);
  }
  fs.rmSync(root, { recursive: true });
});

test("canonical registry bytes are deterministic", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, b: 3 } }),
    '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n',
  );
});

test("reviewed host key becomes the strict isolated SSH authority", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "remote-builder-known-hosts-"));
  const env = installReviewedSshHostAuthority({ HOME: root }, endpoint);
  assert.match(String(env.NIX_SSHOPTS), /StrictHostKeyChecking=yes/);
  const file = String(env.NIX_SSHOPTS).match(/UserKnownHostsFile=([^ ]+)/)?.[1] || "";
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(
    fs.readFileSync(file, "utf8"),
    `builder.example.com ssh-ed25519 ${endpoint.hostKey.publicKey}\n`,
  );
  fs.rmSync(root, { recursive: true });
});

test("attestation and registration use bounded canonical store authorities", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const attest = fs.readFileSync(
    path.resolve(here, "../../remote-exec/nix-remote-builder-attest.ts"),
    "utf8",
  );
  const register = fs.readFileSync(
    path.resolve(here, "../../remote-exec/nix-remote-builder-register.ts"),
    "utf8",
  );
  const smoke = fs.readFileSync(
    path.resolve(here, "../../remote-exec/nix-remote-builder-smoke.ts"),
    "utf8",
  );
  const signer = fs.readFileSync(
    path.resolve(here, "../../remote-exec/nix-protected-store-sign.ts"),
    "utf8",
  );
  const activeRemoteNix = fs.readFileSync(
    path.resolve(here, "../../remote-exec/active-reviewed-remote-nix.ts"),
    "utf8",
  );
  const reproducibilityProducer = fs.readFileSync(
    path.resolve(here, "../../ci/produce-artifact-reproducibility-evidence.ts"),
    "utf8",
  );
  const recordStorage = fs.readFileSync(
    path.resolve(here, "../../ci/artifact-reproducibility-record-storage.ts"),
    "utf8",
  );
  assert.match(attest, /artifactNixPolicyConfigArgs/);
  assert.match(attest, /"store", "info", "--json"/);
  assert.match(attest, /runRemoteBuilderProbes/);
  assert.match(attest, /viberoots-remote-builder-policy-v3/);
  assert.match(register, /canonical one-file directory/);
  assert.match(register, /importRemoteBuilderAuthorities/);
  assert.ok(
    register.indexOf("await importRemoteBuilderAuthorities") <
      register.indexOf("await assertionAt(opts.policyStorePath)"),
  );
  assert.match(register, /opts\.dryRun/);
  assert.match(register, /refuses to mutate an existing immutable builder identity/);
  assert.match(register, /assertion\.supportedSystem/);
  assert.match(register, /assertion\.probeFlakeStorePath !== opts\.probeFlakeStorePath/);
  assert.match(register, /previous registry must be the exact immutable canonical registry file/);
  assert.ok(
    register.indexOf("verifyProtectedStoreSignature(opts.previousRegistryPath") <
      register.indexOf("fs.readFile(opts.previousRegistryPath"),
  );
  assert.match(register, /viberoots-reviewed-remote-builders-v3/);
  assert.match(signer, /signAndVerifyProtectedStore/);
  assert.doesNotMatch(signer, /readFile|console\.log|signingKeyFile.*stdout/);
  assert.match(smoke, /NIX_REMOTE: transport\.builderUri/);
  assert.ok(
    smoke.indexOf("await verifyProtectedStoreSignature") <
      smoke.indexOf("parseReviewedRemoteBuilders(JSON.parse(registryText))"),
  );
  assert.doesNotMatch(smoke, /args:\s*\[[^\]]*builderUri/s);
  assert.doesNotMatch(`${attest}\n${register}`, /\.nothrow\(|\$`|builderUri/);
  assert.match(reproducibilityProducer, /withActiveReviewedRemoteNix/);
  assert.match(reproducibilityProducer, /runRemoteBuilderSmoke/);
  assert.match(reproducibilityProducer, /resolveArtifactReproducibilityMatrixBinding/);
  assert.match(reproducibilityProducer, /storeFinalizedArtifactRunRecord/);
  assert.doesNotMatch(reproducibilityProducer, /createArtifactReproducibilityRunRecord/);
  assert.match(recordStorage, /createArtifactReproducibilityRunRecord/);
  assert.match(recordStorage, /run-record\.json/);
  assert.doesNotMatch(reproducibilityProducer, /required\("(?:flake-ref|target)"\)/u);
  assert.doesNotMatch(reproducibilityProducer, /runArtifactNix\(\{\s*args:\s*\["build"/u);
  assert.match(activeRemoteNix, /verifyProtectedStoreSignature/);
  assert.match(activeRemoteNix, /env: childEnv/);
  assert.doesNotMatch(activeRemoteNix, /args:\s*[^\n]*builderUri/u);
});
