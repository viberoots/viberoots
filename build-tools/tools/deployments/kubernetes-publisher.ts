#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { KubernetesDeployment } from "./contract";
import { scrubDeploymentSecretEnv } from "./deployment-secret-env";
import {
  assertKubernetesLiveStateMatchesDeployment,
  type KubernetesLiveDriftCheck,
} from "./kubernetes-live-drift";

function commandError(stdout: string, stderr: string): Error {
  return new Error([stderr.trim(), stdout.trim()].filter(Boolean)[0] || "helm release failed");
}

function providerReleaseIdFor(opts: {
  deployment: KubernetesDeployment;
  componentId: string;
}): string {
  const target = opts.deployment.providerTarget;
  return `helm-release:${target.cluster}/${target.namespace}/${target.release}#component:${opts.componentId}`;
}

async function withReviewedKubeconfig<T>(
  credentials: Record<string, string> | undefined,
  run: (paths: { kubeconfigPath: string; homePath: string }) => Promise<T>,
): Promise<T> {
  const kubeconfig = String(credentials?.kubernetes_publish_kubeconfig || "").trim();
  if (!kubeconfig) {
    throw new Error("kubernetes publish requires reviewed kubernetes_publish_kubeconfig");
  }
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-kubernetes-publish-"));
  const kubeconfigPath = path.join(tempRoot, "kubeconfig");
  const homePath = path.join(tempRoot, "home");
  try {
    await fsp.mkdir(homePath, { recursive: true });
    await fsp.writeFile(kubeconfigPath, kubeconfig, { encoding: "utf8", mode: 0o600 });
    return await run({ kubeconfigPath, homePath });
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function publishKubernetesComponent(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
  chart: string;
  renderedConfigPath: string;
  componentId: string;
  artifactPath: string;
  publishCredentialEnv?: Record<string, string>;
}): Promise<{ providerReleaseId: string; liveDriftCheck: KubernetesLiveDriftCheck }> {
  const helmBin = process.env.VBR_KUBERNETES_HELM_BIN || "helm";
  const liveDriftCheck = await assertKubernetesLiveStateMatchesDeployment({
    deployment: opts.deployment,
    liveStatePath: process.env.VBR_KUBERNETES_LIVE_STATE_PATH,
  });
  const command = [
    "upgrade",
    "--install",
    opts.deployment.providerTarget.release,
    opts.chart,
    "--namespace",
    opts.deployment.providerTarget.namespace,
    "--kube-context",
    opts.deployment.providerTarget.cluster,
    "--kubeconfig",
    "__KUBECONFIG__",
    "--values",
    opts.renderedConfigPath,
    "--set-string",
    `vbr.componentId=${opts.componentId}`,
    "--set-string",
    `vbr.artifactPath=${opts.artifactPath}`,
  ];
  const run = await withReviewedKubeconfig(opts.publishCredentialEnv, async (paths) => {
    const resolvedCommand = command.map((arg) =>
      arg === "__KUBECONFIG__" ? paths.kubeconfigPath : arg,
    );
    return await $({
      cwd: opts.workspaceRoot,
      stdio: "pipe",
      env: {
        ...scrubDeploymentSecretEnv(),
        ...(opts.publishCredentialEnv || {}),
        HOME: paths.homePath,
        KUBECONFIG: paths.kubeconfigPath,
        HELM_CACHE_HOME: path.join(paths.homePath, ".cache", "helm"),
        HELM_CONFIG_HOME: path.join(paths.homePath, ".config", "helm"),
        HELM_DATA_HOME: path.join(paths.homePath, ".local", "share", "helm"),
        VBR_KUBERNETES_COMPONENT_ID: opts.componentId,
        VBR_KUBERNETES_COMPONENT_ARTIFACT: opts.artifactPath,
        VBR_KUBERNETES_RENDERED_CONFIG: opts.renderedConfigPath,
      },
    })`${helmBin} ${resolvedCommand}`.nothrow();
  });
  const stdout = String((run as any).stdout || "");
  const stderr = String((run as any).stderr || "");
  if ((run as any).exitCode !== 0) throw commandError(stdout, stderr);
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index] || "{}") as { providerReleaseId?: string };
      if (typeof parsed.providerReleaseId === "string" && parsed.providerReleaseId.trim()) {
        return { providerReleaseId: parsed.providerReleaseId.trim(), liveDriftCheck };
      }
    } catch {}
  }
  return { providerReleaseId: providerReleaseIdFor(opts), liveDriftCheck };
}
