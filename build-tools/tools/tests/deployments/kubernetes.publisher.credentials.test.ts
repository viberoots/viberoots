#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { publishKubernetesComponent } from "../../deployments/kubernetes-publisher";
import { kubernetesDeploymentFixture, writeKubernetesLiveStateFixture } from "./kubernetes.fixture";
import { runInTemp } from "../lib/test-helpers";

const HELM_RECORDER = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const logPath = process.env.VBR_KUBERNETES_FAKE_HELM_LOG;
const watchedKeys = [
  "kubernetes_publish_kubeconfig",
  "VBR_DEPLOYER_OIDC_SECRET",
  "VBR_DEPLOYMENT_CLIENT_TOKEN",
  "VAULT_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "KUBECONFIG",
  "HELM_KUBETOKEN",
  "HOME",
  "VBR_KUBERNETES_COMPONENT_ID",
];
fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.writeFileSync(
  logPath,
  JSON.stringify(
    {
      argv: process.argv.slice(2),
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
    const deployment = kubernetesDeploymentFixture();
    const liveStatePath = await writeKubernetesLiveStateFixture(tmp, deployment);
    const previous = { ...process.env };
    process.env.VBR_KUBERNETES_HELM_BIN = helmPath;
    process.env.VBR_KUBERNETES_FAKE_HELM_LOG = logPath;
    process.env.VBR_KUBERNETES_LIVE_STATE_PATH = liveStatePath;
    process.env.VBR_DEPLOYER_OIDC_SECRET = "ambient-secret";
    process.env.VBR_DEPLOYMENT_CLIENT_TOKEN = "ambient-token";
    process.env.VAULT_TOKEN = "ambient-vault";
    process.env.CLOUDFLARE_API_TOKEN = "ambient-cloudflare";
    process.env.KUBECONFIG = path.join(tmp, "ambient-kubeconfig");
    process.env.HELM_KUBETOKEN = "ambient-helm-token";
    process.env.PATH = `${binDir}:${process.env.PATH || ""}`;
    try {
      await assert.rejects(
        publishKubernetesComponent({
          workspaceRoot: tmp,
          deployment,
          chart: "./charts/api",
          renderedConfigPath,
          componentId: "api",
          artifactPath,
          publishCredentialEnv: {},
        }),
        /requires reviewed kubernetes_publish_kubeconfig/,
      );
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
      assert.equal(recorded.env.VBR_DEPLOYER_OIDC_SECRET, undefined);
      assert.equal(recorded.env.VBR_DEPLOYMENT_CLIENT_TOKEN, undefined);
      assert.equal(recorded.env.VAULT_TOKEN, undefined);
      assert.equal(recorded.env.CLOUDFLARE_API_TOKEN, undefined);
      assert.match(recorded.env.KUBECONFIG, /vbr-kubernetes-publish-/);
      assert.match(recorded.env.HOME, /vbr-kubernetes-publish-/);
      assert.equal(recorded.env.HELM_KUBETOKEN, undefined);
      assert.equal(recorded.env.VBR_KUBERNETES_COMPONENT_ID, "api");
      assert.ok(
        (recorded.argv as string[]).includes(`vbr.componentId=api`),
        `expected helm argv to include vbr.componentId=api, got: ${JSON.stringify(recorded.argv)}`,
      );
      assert.ok(
        (recorded.argv as string[]).includes(`vbr.artifactPath=${artifactPath}`),
        `expected helm argv to include vbr.artifactPath=${artifactPath}, got: ${JSON.stringify(recorded.argv)}`,
      );
      assert.ok((recorded.argv as string[]).includes("--kubeconfig"));
      assert.ok(!(recorded.argv as string[]).includes(path.join(tmp, "ambient-kubeconfig")));
    } finally {
      for (const name of [
        "VBR_KUBERNETES_HELM_BIN",
        "VBR_KUBERNETES_FAKE_HELM_LOG",
        "VBR_KUBERNETES_LIVE_STATE_PATH",
        "VBR_DEPLOYER_OIDC_SECRET",
        "VBR_DEPLOYMENT_CLIENT_TOKEN",
        "VAULT_TOKEN",
        "CLOUDFLARE_API_TOKEN",
        "KUBECONFIG",
        "HELM_KUBETOKEN",
      ]) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
      process.env.PATH = previous.PATH || "";
    }
  });
});
