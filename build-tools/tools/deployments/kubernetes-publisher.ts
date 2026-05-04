#!/usr/bin/env zx-wrapper
import type { KubernetesDeployment } from "./contract.ts";
import { scrubDeploymentSecretEnv } from "./deployment-secret-env.ts";

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

export async function publishKubernetesComponent(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
  chart: string;
  renderedConfigPath: string;
  componentId: string;
  artifactPath: string;
  publishCredentialEnv?: Record<string, string>;
}): Promise<{ providerReleaseId: string }> {
  const helmBin = process.env.BNX_KUBERNETES_HELM_BIN || "helm";
  const command = [
    "upgrade",
    "--install",
    opts.deployment.providerTarget.release,
    opts.chart,
    "--namespace",
    opts.deployment.providerTarget.namespace,
    "--kube-context",
    opts.deployment.providerTarget.cluster,
    "--values",
    opts.renderedConfigPath,
    "--set-string",
    `bnx.componentId=${opts.componentId}`,
    "--set-string",
    `bnx.artifactPath=${opts.artifactPath}`,
  ];
  const run = await $({
    cwd: opts.workspaceRoot,
    stdio: "pipe",
    env: {
      ...scrubDeploymentSecretEnv(),
      ...(opts.publishCredentialEnv || {}),
      BNX_KUBERNETES_COMPONENT_ID: opts.componentId,
      BNX_KUBERNETES_COMPONENT_ARTIFACT: opts.artifactPath,
      BNX_KUBERNETES_RENDERED_CONFIG: opts.renderedConfigPath,
    },
  })`${helmBin} ${command}`.nothrow();
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
        return { providerReleaseId: parsed.providerReleaseId.trim() };
      }
    } catch {}
  }
  return { providerReleaseId: providerReleaseIdFor(opts) };
}
