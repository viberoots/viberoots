#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { evaluateDefaultLocalPolicy } from "../../remote-exec/default-local-policy";
import { validRuntimeInventory } from "./runtime-prerequisites.fixture";

const inventoryFile = "viberoots/build-tools/tools/nix/flake/packages/remote-worker-tools.nix";

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-prereq-policy-"));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, text, "utf8");
  }
  return root;
}

test("remote-ready helpers cannot use provider executables from ambient PATH", async () => {
  const root = await fixture({
    [inventoryFile]: validRuntimeInventory,
    "build-tools/tools/remote-exec/publisher.ts":
      "// remote-ready helper uses remote-ci-tools\nawait $`aws s3 cp a b`;\n",
  });

  const report = await evaluateDefaultLocalPolicy(root);

  assert.equal(report.ok, false);
  assert.match(report.findings.map((f) => f.message).join("\n"), /ambient executable: aws/);
});

test("remote-ready helpers may use provider executables only when declared packages are composed into a closure", async () => {
  const root = await fixture({
    [inventoryFile]: `
{
  workerPaths = [];
  declaredRemoteExecutablePackages = {
    aws = pkgs.awscli2;
  };
  declaredRemoteExecutablePaths = builtins.attrValues declaredRemoteExecutablePackages;
  ciPaths = workerPaths ++ declaredRemoteExecutablePaths;
  allowedPrimitives = [
    "kernel-sandbox-support"
    "disk-capacity"
    "network-reachability"
    "mounted-credentials-or-workload-identity"
    "trust-anchors"
    "clock"
    "minimal-nix-bootstrap"
  ];
}
`,
    "build-tools/tools/remote-exec/publisher.ts": "remote-ready\nawait $`aws s3 cp a b`;\n",
  });

  const report = await evaluateDefaultLocalPolicy(root);

  assert.equal(report.ok, true);
});

test("remote-ready helper executable declaration must be composed into a Nix closure", async () => {
  const root = await fixture({
    [inventoryFile]: `
{
  declaredRemoteExecutablePackages = {
    aws = pkgs.awscli2;
  };
  allowedPrimitives = [
    "kernel-sandbox-support"
    "disk-capacity"
    "network-reachability"
    "mounted-credentials-or-workload-identity"
    "trust-anchors"
    "clock"
    "minimal-nix-bootstrap"
  ];
}
`,
    "build-tools/tools/remote-exec/publisher.ts": "remote-ready\nawait $`aws s3 cp a b`;\n",
  });

  const report = await evaluateDefaultLocalPolicy(root);

  assert.equal(report.ok, false);
  assert.match(report.findings.map((f) => f.message).join("\n"), /ambient executable: aws/);
});

test("executable prerequisites cannot be listed as allowed primitives", async () => {
  const root = await fixture({
    [inventoryFile]: `
{
  allowedPrimitives = [
    "kernel-sandbox-support"
    "disk-capacity"
    "network-reachability"
    "mounted-credentials-or-workload-identity"
    "trust-anchors"
    "clock"
    "minimal-nix-bootstrap"
    "ssh"
  ];
}
`,
  });

  const report = await evaluateDefaultLocalPolicy(root);

  assert.equal(report.ok, false);
  assert.match(report.findings.map((f) => f.message).join("\n"), /executable ssh/);
});

test("remote runtime prerequisite policy passes against current repository", async () => {
  const report = await evaluateDefaultLocalPolicy(process.cwd());
  assert.deepEqual(report.findings, []);
});
