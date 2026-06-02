import type {
  HookAdapter,
  HookAdapterPhase,
  HookAdapterPhaseOptions,
} from "./cloud-control-provider-capability-hooks";
import { validateRemainingProviderCapabilityPayload } from "./cloud-control-remaining-capability-validation";

type RemainingCapabilityInputKey =
  | "awsAtticCacheEvidence"
  | "cloudflareEdgeEvidence"
  | "vercelOperatorUiEvidence"
  | "remoteBuildWorkerFleetEvidence";

const INPUT_KEYS: Record<string, RemainingCapabilityInputKey> = {
  "aws-attic-cache-service": "awsAtticCacheEvidence",
  "cloudflare-edge": "cloudflareEdgeEvidence",
  "vercel-operator-ui": "vercelOperatorUiEvidence",
  "remote-build-worker-fleet": "remoteBuildWorkerFleetEvidence",
};

export function remainingCapabilityHookAdapter(capabilityId: string): HookAdapter {
  const phase =
    (name: string): HookAdapterPhase =>
    async (opts) =>
      hookResult(capabilityId, name, opts);
  return {
    name: `typed-${capabilityId}`,
    automated: true,
    preview: phase("preview"),
    apply: phase("apply"),
    evidence: phase("evidence"),
    smoke: phase("smoke"),
    rollback: phase("rollback"),
    reviewedImport: phase("reviewed-import"),
  };
}

function hookResult(capabilityId: string, phase: string, opts: HookAdapterPhaseOptions) {
  const payload = typedPayload(capabilityId, opts);
  const errors = validateRemainingProviderCapabilityPayload(capabilityId, payload, {
    awsTopology: opts.awsTopologyEvidence,
  });
  if (errors.length > 0) {
    throw new Error(`${capabilityId} evidence rejected: ${errors.join("; ")}`);
  }
  return {
    summary: `${capabilityId} ${phase}`,
    rawOutput: outputSummary(capabilityId, phase, payload),
    payload,
  };
}

function typedPayload(capabilityId: string, opts: HookAdapterPhaseOptions) {
  const key = INPUT_KEYS[capabilityId];
  const payload = key ? opts[key] : undefined;
  if (!payload) throw new Error(`${capabilityId} requires ${evidenceFlag(capabilityId)}`);
  return payload;
}

function evidenceFlag(capabilityId: string): string {
  if (capabilityId === "aws-attic-cache-service") return "--aws-attic-cache-evidence";
  if (capabilityId === "cloudflare-edge") return "--cloudflare-edge-evidence";
  if (capabilityId === "vercel-operator-ui") return "--vercel-operator-ui-evidence";
  return "--remote-build-worker-fleet-evidence";
}

function outputSummary(
  capabilityId: string,
  phase: string,
  payload: Record<string, unknown>,
): string {
  return JSON.stringify({
    capabilityId,
    phase,
    schemaVersion: payload.schemaVersion,
    checkedAt: payload.checkedAt,
    ownership: payload.ownership,
    smoke: payload.smoke,
    rollback: payload.rollback,
  });
}
