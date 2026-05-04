#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { publishKubernetesComponent } from "../../deployments/kubernetes-publisher.ts";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";

const HELM_RECORDER = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const logPath = process.env.BNX_KUBERNETES_FAKE_HELM_LOG;
const watchedKeys = [
  "kubernetes_publish_kubeconfig",
  "BNX_DEPLOYER_OIDC_SECRET",
  "BNX_DEPLOYMENT_CLIENT_TOKEN",
  "VAULT_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "BNX_KUBERNETES_COMPONENT_ID",
];
fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.writeFileSync(
  logPath,
  JSON.stringify(
    {
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => watchedKeys.includes(key)),
      ),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ providerReleaseId: "fake-release-1" }));
`;

async function installHelmRecorder(tmp: string) {
  const binDir = path.join(tmp, "bin");
  await fsp.mkdir(binDir, { recursive: true });
  const recorderPath = path.join(binDir, "helm-recorder.mjs");
  await fsp.writeFile(recorderPath, HELM_RECORDER, "utf8");
  const helmPath = path.join(binDir, "helm");
  await fsp.writeFile(helmPath, `#!/bin/sh\nexec node "${recorderPath}" "$@"\n`, {
    encoding: "utf8",
    mode: 0o755,
  });
  return { binDir, helmPath };
}

test("publisher process receives reviewed credential env and no ambient provider secrets", async () => {
  await runInTemp("kubernetes-publisher-creds", async (tmp) => {
    const { binDir, helmPath } = await installHelmRecorder(tmp);
    const renderedConfigPath = path.join(tmp, "values.json");
    await fsp.writeFile(renderedConfigPath, "{}", "utf8");
    const artifactPath = path.join(tmp, "artifact");
    await fsp.mkdir(artifactPath, { recursive: true });
    const logPath = path.join(tmp, "publisher-env.json");
    const previous = { ...process.env };
    process.env.BNX_KUBERNETES_HELM_BIN = helmPath;
    process.env.BNX_KUBERNETES_FAKE_HELM_LOG = logPath;
    process.env.BNX_DEPLOYER_OIDC_SECRET = "ambient-secret";
    process.env.BNX_DEPLOYMENT_CLIENT_TOKEN = "ambient-token";
    process.env.VAULT_TOKEN = "ambient-vault";
    process.env.CLOUDFLARE_API_TOKEN = "ambient-cloudflare";
    process.env.PATH = `${binDir}:${process.env.PATH || ""}`;
    try {
      const deployment = kubernetesDeploymentFixture();
      await publishKubernetesComponent({
        workspaceRoot: tmp,
        deployment,
        chart: "./charts/api",
        renderedConfigPath,
        componentId: "api",
        artifactPath,
        publishCredentialEnv: { kubernetes_publish_kubeconfig: "reviewed-only" },
      });
      const recorded = JSON.parse(await fsp.readFile(logPath, "utf8"));
      assert.equal(recorded.env.kubernetes_publish_kubeconfig, "reviewed-only");
      assert.equal(recorded.env.BNX_DEPLOYER_OIDC_SECRET, undefined);
      assert.equal(recorded.env.BNX_DEPLOYMENT_CLIENT_TOKEN, undefined);
      assert.equal(recorded.env.VAULT_TOKEN, undefined);
      assert.equal(recorded.env.CLOUDFLARE_API_TOKEN, undefined);
      assert.equal(recorded.env.BNX_KUBERNETES_COMPONENT_ID, "api");
    } finally {
      delete process.env.BNX_KUBERNETES_HELM_BIN;
      delete process.env.BNX_KUBERNETES_FAKE_HELM_LOG;
      process.env.BNX_DEPLOYER_OIDC_SECRET = previous.BNX_DEPLOYER_OIDC_SECRET || "";
      process.env.BNX_DEPLOYMENT_CLIENT_TOKEN = previous.BNX_DEPLOYMENT_CLIENT_TOKEN || "";
      process.env.VAULT_TOKEN = previous.VAULT_TOKEN || "";
      process.env.CLOUDFLARE_API_TOKEN = previous.CLOUDFLARE_API_TOKEN || "";
      process.env.PATH = previous.PATH || "";
    }
  });
});
