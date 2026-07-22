#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { ArtifactCommandResult } from "../../lib/artifact-command-runner";
import { importRemoteBuilderAuthorities } from "../../remote-exec/nix-remote-builder-import";

const policy = "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-viberoots-remote-builder-policy-v3";
const probe = "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-remote-builder-probes";
const endpoint = {
  schema: "viberoots.remote-builder-endpoint.v2",
  protocol: "ssh-ng",
  host: "builder.example.com",
  port: 22,
  user: "nix",
  hostKey: {
    algorithm: "ssh-ed25519",
    publicKey: "AAAAC3NzaC1lZDI1NTE5AAAAIHZs0h63XqwPCOe+Hw1bExE5FU8XeADMOijgI1J0/R9q",
    fingerprint: "SHA256:hKX2WRrp0EaRIfb000oRGYXwjSTqwnV9h8n/vb2P9JA",
  },
};

function success(): ArtifactCommandResult {
  return { exitCode: 0, stdout: "", stderr: "", timedOut: false, interrupted: false, childPid: 1 };
}

test("administrator imports and verifies exact remote assertion and probe authorities", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "remote-builder-import-"));
  const endpointPath = path.join(root, "endpoint.json");
  const transportFile = path.join(root, "transport.json");
  const key = path.join(root, "builder-key");
  fs.writeFileSync(endpointPath, JSON.stringify(endpoint));
  fs.writeFileSync(key, "fixture", { mode: 0o600 });
  fs.writeFileSync(
    transportFile,
    JSON.stringify({
      schema: "viberoots.remote-builder-ssh-transport.v2",
      builderUri: `ssh-ng://nix@builder.example.com?ssh-key=${key}`,
    }),
    { mode: 0o600 },
  );
  let imported = false;
  const calls: string[][] = [];
  await importRemoteBuilderAuthorities({
    nix: "/nix/store/cccccccccccccccccccccccccccccccc-tools/bin/nix",
    endpointPath,
    transportFile,
    policyStorePath: policy,
    probeFlakeStorePath: probe,
    env: { HOME: path.join(root, "home") },
    runNix: async (args, env) => {
      calls.push(args);
      assert.match(String(env.NIX_SSHOPTS), /StrictHostKeyChecking=yes/);
      assert.match(String(env.NIX_SSHOPTS), new RegExp(`IdentityFile=${key}$`));
      assert.doesNotMatch(args.join(" "), /ssh-key|builder-key/);
      if (args[0] === "copy") imported = true;
      if (args[0] === "store" && !imported) return { ...success(), exitCode: 1 };
      return success();
    },
  });
  assert.deepEqual(calls, [
    ["copy", "--from", "ssh-ng://nix@builder.example.com", policy, probe],
    ["store", "verify", "--recursive", "--no-trust", policy, probe],
  ]);
  assert.equal(fs.statSync(path.join(root, "home", ".ssh")).mode & 0o777, 0o700);
  fs.rmSync(root, { recursive: true });
});

test("failed content verification blocks the imported authority", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "remote-builder-import-failure-"));
  const endpointPath = path.join(root, "endpoint.json");
  const transportFile = path.join(root, "transport.json");
  const key = path.join(root, "builder-key");
  fs.writeFileSync(endpointPath, JSON.stringify(endpoint));
  fs.writeFileSync(key, "fixture", { mode: 0o600 });
  fs.writeFileSync(
    transportFile,
    JSON.stringify({
      schema: "viberoots.remote-builder-ssh-transport.v2",
      builderUri: `ssh-ng://nix@builder.example.com?ssh-key=${key}`,
    }),
    { mode: 0o600 },
  );
  await assert.rejects(
    importRemoteBuilderAuthorities({
      nix: "nix",
      endpointPath,
      transportFile,
      policyStorePath: policy,
      probeFlakeStorePath: probe,
      env: { HOME: path.join(root, "home") },
      runNix: async (args) =>
        args[0] === "copy" ? success() : { ...success(), exitCode: 1, stderr: "corrupt path" },
    }),
    /artifact command imported remote builder authority verification exited 1: corrupt path/u,
  );
  fs.rmSync(root, { recursive: true });
});

test("administrator runbook closes the six-builder and signed-record handoff", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const setup = fs.readFileSync(path.resolve(here, "../../../docs/remote-build-setup.md"), "utf8");
  const ci = fs.readFileSync(path.resolve(here, "../../../../docs/handbook/ci.md"), "utf8");
  for (const identity of [
    "darwin-aarch64-one",
    "darwin-aarch64-two",
    "linux-aarch64-one",
    "linux-aarch64-two",
    "linux-x86_64-one",
    "linux-x86_64-two",
  ])
    assert.match(setup, new RegExp(`reviewed:${identity}`));
  assert.match(setup, /previous=\(--registry "\$registry"\)/);
  assert.match(setup, /--transport-file "\$transport"/);
  assert.match(setup, /sole content-addressed cross-host transfer/);
  assert.match(setup, /signed predecessor registry/);
  assert.match(setup, /test "\$index" -eq 6/);
  assert.match(setup, /aarch64-darwin\/\{darwin-aarch64-one,darwin-aarch64-two\}\.json/);
  assert.match(setup, /sole run-record signing boundary/);
  assert.match(setup, /secret:\/\/ci\/hermetic-builds\/remote-builders\/<reviewed-identity>/);
  assert.match(setup, /evidence-store-aws-shared-credentials/);
  assert.match(setup, /secret:\/\/ci\/hermetic-builds\/reproducibility\/evidence-signing-key/);
  assert.match(ci, /Cells receive no signing key and upload\s+unsigned/u);
  assert.match(ci, /aggregate credential sign every accepted record and observation/u);
  assert.match(ci, /accepted artifact\s+output's complete closure/u);
  assert.match(ci, /signature-checking readback before signing/u);
});
