#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import type { KubernetesDeployment } from "./contract";

export type KubernetesLiveDriftCheck = {
  policy: "fail_closed_release_identity";
  status: "in_sync";
  liveStatePath?: string;
};

type LiveState = {
  cluster?: string;
  namespace?: string;
  release?: string;
  providerTargetIdentity?: string;
  provider_target_identity?: string;
};

function readField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function expectedFields(deployment: KubernetesDeployment): Record<string, string> {
  return {
    cluster: deployment.providerTarget.cluster,
    namespace: deployment.providerTarget.namespace,
    release: deployment.providerTarget.release,
    providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
  };
}

function mismatches(deployment: KubernetesDeployment, live: LiveState): string[] {
  const expected = expectedFields(deployment);
  const liveIdentity = readField(live.providerTargetIdentity || live.provider_target_identity);
  return Object.entries({
    cluster: readField(live.cluster),
    namespace: readField(live.namespace),
    release: readField(live.release),
    providerTargetIdentity: liveIdentity,
  }).flatMap(([field, actual]) =>
    actual && actual !== expected[field]
      ? [`${field}: live=${actual} expected=${expected[field]}`]
      : [],
  );
}

export async function assertKubernetesLiveStateMatchesDeployment(opts: {
  deployment: KubernetesDeployment;
  liveStatePath?: string;
}): Promise<KubernetesLiveDriftCheck> {
  const liveStatePath = opts.liveStatePath?.trim();
  if (!liveStatePath) {
    throw new Error("kubernetes live-state drift check requires VBR_KUBERNETES_LIVE_STATE_PATH");
  }
  const raw = await fsp.readFile(liveStatePath, "utf8").catch((error: any) => {
    if (error?.code === "ENOENT") {
      throw new Error(`kubernetes live-state file is missing: ${liveStatePath}`);
    }
    throw error;
  });
  if (!raw.trim()) {
    throw new Error(`kubernetes live-state file is empty: ${liveStatePath}`);
  }
  const live = JSON.parse(raw) as LiveState;
  const drift = mismatches(opts.deployment, live);
  if (drift.length > 0) {
    throw new Error(`kubernetes live-state drift detected before publish\n${drift.join("\n")}`);
  }
  return { policy: "fail_closed_release_identity", status: "in_sync", liveStatePath };
}
