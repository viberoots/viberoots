#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { runDeploymentControlPlaneCommand } from "../../deployments/deployment-control-plane";
import {
  runtimeInputArgs,
  supabaseProfileArgs,
  withControlPlaneArgv,
  writeRuntimeConfig,
} from "./control-plane-process-entrypoints.helpers";
import { ingressCommandEvidence } from "./cloud-control-aws-ingress.fixture";
import { runInTemp } from "../lib/test-helpers";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";

const SETUP_IMAGE =
  "registry.example.com/platform/deployment-control-plane@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SETUP_DIGEST = `sha256:${"a".repeat(64)}`;
const SETUP_BUILD_IDENTITY = `nix-source-${"b".repeat(64)}`;

test("deployment-control-plane command validates mode config overrides and credentials", async () => {
  await runInTemp("control-plane-cli-config", async (tmp) => {
    await assert.rejects(
      () => withControlPlaneArgv(["status"], runDeploymentControlPlaneCommand),
      /usage:/,
    );
    await assert.rejects(
      () => withControlPlaneArgv(["service"], runDeploymentControlPlaneCommand),
      /--config/,
    );
    await assert.rejects(
      () => withControlPlaneArgv(["worker"], runDeploymentControlPlaneCommand),
      /--config/,
    );
    const malformedPath = path.join(tmp, "malformed.yaml");
    await fsp.writeFile(malformedPath, "not: [valid\n", "utf8");
    await assert.rejects(
      () =>
        withControlPlaneArgv(["service", "--config", malformedPath], async () => {
          await runDeploymentControlPlaneCommand();
        }),
      /Flow sequence in block collection/,
    );
    const missing = await writeRuntimeConfig(path.join(tmp, "missing"), { omit: ["secret"] });
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          ["worker", "--config", missing.configPath, "--worker-id", "worker-missing"],
          async () => {
            await runDeploymentControlPlaneCommand();
          },
        ),
      /missing required credential files/,
    );
    const serviceConfig = await writeRuntimeConfig(path.join(tmp, "service"));
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          ["service", "--config", serviceConfig.configPath, "--token", "argv-secret"],
          runDeploymentControlPlaneCommand,
        ),
      /requires service\.tokenFile, not --token/,
    );
    const service = await withControlPlaneArgv(
      ["service", "--config", serviceConfig.configPath],
      runDeploymentControlPlaneCommand,
    );
    assert.match((service as any).url, /^http:\/\/127\.0\.0\.1:/);
    await (service as any).close();
    const workerConfig = await writeRuntimeConfig(path.join(tmp, "worker"));
    const worker = await withControlPlaneArgv(
      ["worker", "--config", workerConfig.configPath, "--worker-id", "worker-cli"],
      runDeploymentControlPlaneCommand,
    );
    assert.equal((worker as any).workerId, "worker-cli");
    await (worker as any).close();
  });
});

test("deployment-control-plane setup writes a cloud host profile bundle", async () => {
  await runInTemp("control-plane-cli-setup", async (tmp) => {
    const out = path.join(tmp, "profile");
    const topologyFile = path.join(tmp, "aws-topology-evidence.json");
    const publicationFile = path.join(tmp, "image-publication.json");
    const ingressCommandEvidenceFiles = await writeIngressCommandEvidence(tmp);
    await fsp.writeFile(topologyFile, JSON.stringify(privateLinkAwsTopology()), "utf8");
    await fsp.writeFile(publicationFile, JSON.stringify(publicationEvidence()), "utf8");
    await withControlPlaneArgv(
      [
        "setup",
        "--out",
        out,
        "--host-mode",
        "aws-ec2",
        "--image-publication-evidence",
        publicationFile,
        "--aws-topology-evidence",
        topologyFile,
        "--ingress-command-evidence",
        ingressCommandEvidenceFiles.join(","),
        ...(await supabaseProfileArgs(tmp)),
        ...(await runtimeInputArgs(tmp)),
      ],
      runDeploymentControlPlaneCommand,
    );
    assert.ok(await exists(path.join(out, "config.yaml")));
    assert.ok(await exists(path.join(out, "credential-manifest.json")));
    assert.ok(await exists(path.join(out, "provider-capabilities.json")));
    const profile = YAML.parse(await fsp.readFile(path.join(out, "aws-ec2-profile.yaml"), "utf8"));
    assert.equal(profile.artifactBackend.defaultPath, "AWS S3 through a VPC endpoint");
    assert.equal(profile.processes.length, 3);
  });
});

test("deployment-control-plane standby process modes gate service and workers", async () => {
  await runInTemp("control-plane-cli-standby", async (tmp) => {
    const serviceOnly = await writeRuntimeConfig(path.join(tmp, "service-only"), {
      processMode: "service-only",
    });
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          ["worker", "--config", serviceOnly.configPath, "--worker-id", "blocked"],
          runDeploymentControlPlaneCommand,
        ),
      /worker mode is disabled/,
    );
    const workerOnly = await writeRuntimeConfig(path.join(tmp, "worker-only"), {
      processMode: "worker-only",
    });
    await assert.rejects(
      () =>
        withControlPlaneArgv(["service", "--config", workerOnly.configPath], async () => {
          await runDeploymentControlPlaneCommand();
        }),
      /service mode is disabled/,
    );
    const disabled = await writeRuntimeConfig(path.join(tmp, "disabled"), {
      processMode: "fully-disabled",
    });
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          ["worker", "--config", disabled.configPath, "--process-mode", "fully-disabled"],
          runDeploymentControlPlaneCommand,
        ),
      /process mode is disabled/,
    );
    const reenabled = await withControlPlaneArgv(
      [
        "worker",
        "--config",
        disabled.configPath,
        "--process-mode",
        "fully-enabled",
        "--worker-id",
        "reenabled-worker",
      ],
      runDeploymentControlPlaneCommand,
    );
    assert.equal((reenabled as any).workerId, "reenabled-worker");
    await (reenabled as any).close();
    const service = await withControlPlaneArgv(
      ["service", "--config", disabled.configPath, "--process-mode", "fully-enabled"],
      runDeploymentControlPlaneCommand,
    );
    assert.match((service as any).url, /^http:\/\/127\.0\.0\.1:/);
    await (service as any).close();
  });
});

async function exists(file: string): Promise<boolean> {
  return await fsp
    .access(file)
    .then(() => true)
    .catch(() => false);
}

async function writeIngressCommandEvidence(tmp: string): Promise<string[]> {
  const bundle = ingressCommandEvidence();
  const files: string[] = [];
  for (const [collector, payload] of Object.entries(bundle)) {
    const file = path.join(tmp, `ingress-${collector}-evidence.json`);
    await fsp.writeFile(file, JSON.stringify(payload), "utf8");
    files.push(file);
  }
  return files;
}

function publicationEvidence() {
  return {
    schemaVersion: "cloud-control-image-publication@1",
    image: SETUP_IMAGE,
    sourceRevision: "source-cli-setup",
    imageBuildIdentity: SETUP_BUILD_IDENTITY,
    digest: SETUP_DIGEST,
    inspectedDigest: SETUP_DIGEST,
    tag: "registry.example.com/platform/deployment-control-plane:source-cli-setup",
    evidenceSource: "generated-command",
    registryProfile: ecrRegistryProfileForImage(SETUP_IMAGE, SETUP_DIGEST),
  };
}
