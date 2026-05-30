import { redactOperatorText } from "./deployment-control-plane-redaction";
import { capabilityDeclaration } from "./cloud-control-setup-contract";
import type { ProviderCapabilityDeclaration } from "./cloud-control-setup-types";
import { validateProviderCapabilityDeclaration } from "./cloud-control-setup-validate";
import {
  CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SCHEMA,
  CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SOURCE,
} from "./cloud-control-provider-capability-hook-contract";
import { awsFoundationHookAdapter } from "./cloud-control-aws-foundation-hooks";
import type { AwsFoundationProfile } from "./cloud-control-aws-foundation-types";

export const CLOUD_PROVIDER_CAPABILITY_HOOK_PHASES = [
  "preview",
  "apply",
  "evidence",
  "smoke",
  "rollback",
] as const;

export type CloudProviderCapabilityHookPhase =
  (typeof CLOUD_PROVIDER_CAPABILITY_HOOK_PHASES)[number];

export type CloudProviderCapabilityHookEvidence = {
  schemaVersion: typeof CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SCHEMA;
  source: typeof CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SOURCE;
  checkedAt: string;
  capabilityId: string;
  phase: CloudProviderCapabilityHookPhase;
  declaration: ProviderCapabilityDeclaration;
  targetIdentity: string;
  credentialSource: string;
  lockScope: string;
  replaySemantics: string;
  auditEvidence: string[];
  auditIdentity: string;
  rollbackProcedure: string[];
  smokeEvidence: boolean;
  hook: { adapter: string; automated: boolean; manualPrerequisite: boolean };
  output: {
    classification: string;
    redacted: boolean;
    summary: string;
    fingerprint: string;
  };
  providerPayload?: Record<string, unknown>;
};

export type HookAdapter = {
  name: string;
  automated: boolean;
  manualPrerequisite?: boolean;
  preview: HookAdapterPhase;
  apply: HookAdapterPhase;
  evidence: HookAdapterPhase;
  smoke: HookAdapterPhase;
  rollback: HookAdapterPhase;
};

export type HookAdapterResult = {
  summary: string;
  rawOutput: string;
  payload?: Record<string, unknown>;
};
export type HookAdapterPhase = (opts: HookAdapterPhaseOptions) => Promise<HookAdapterResult>;
export type HookAdapterPhaseOptions = {
  phase: CloudProviderCapabilityHookPhase;
  deploymentLabel: string;
  declaration: ProviderCapabilityDeclaration;
  awsFoundationInspection?: AwsFoundationProfile;
};

const HOOK_ADAPTERS: Record<string, HookAdapter> = {
  "aws-ec2-control-plane-host": reviewedAdapter("aws-ec2-host-profile"),
  "aws-attic-cache-service": reviewedAdapter("aws-attic-cache-service"),
  "aws-ecr-control-plane-registry": reviewedAdapter("aws-ecr-control-plane-registry"),
  "aws-s3-artifact-store": awsFoundationHookAdapter("aws-s3-artifact-store"),
  "aws-network-foundation": awsFoundationHookAdapter("aws-network-foundation"),
  "supabase-managed-postgres": reviewedAdapter("supabase-managed-postgres"),
  "supabase-privatelink-prerequisite": reviewedAdapter(
    "supabase-privatelink-evidence-gate",
    false,
    true,
  ),
  "cloudflare-edge": reviewedAdapter("cloudflare-edge"),
  "vercel-operator-ui": reviewedAdapter("vercel-operator-ui"),
  "remote-build-worker-fleet": reviewedAdapter("remote-build-worker-fleet"),
};

export async function runCloudProviderCapabilityHook(opts: {
  capabilityId: string;
  phase: CloudProviderCapabilityHookPhase;
  deploymentLabel: string;
  targetIdentity?: string;
  declaration?: ProviderCapabilityDeclaration;
  awsFoundationInspection?: AwsFoundationProfile;
}): Promise<CloudProviderCapabilityHookEvidence> {
  assertSupportedPhase(opts.phase);
  const declaration = opts.declaration || concreteDeclaration(opts.capabilityId);
  assertValidDeclaration(declaration);
  if (declaration.id !== opts.capabilityId) {
    throw new Error(`${opts.capabilityId}: declaration belongs to unrelated capability`);
  }
  if (opts.targetIdentity && opts.targetIdentity !== declaration.targetIdentity) {
    throw new Error(`${opts.capabilityId}: target identity does not match declaration`);
  }
  const adapter = HOOK_ADAPTERS[opts.capabilityId];
  if (!adapter) throw new Error(`${opts.capabilityId}: missing reviewed hook adapter`);
  const result = await adapter[opts.phase]({
    phase: opts.phase,
    deploymentLabel: opts.deploymentLabel,
    declaration,
    ...(opts.awsFoundationInspection
      ? { awsFoundationInspection: opts.awsFoundationInspection }
      : {}),
  });
  const output = redactOperatorText(result.rawOutput);
  if (!output) throw new Error(`${opts.capabilityId}: hook produced no audit output`);
  return {
    schemaVersion: CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SCHEMA,
    source: CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SOURCE,
    checkedAt: new Date().toISOString(),
    capabilityId: opts.capabilityId,
    phase: opts.phase,
    declaration,
    targetIdentity: declaration.targetIdentity,
    credentialSource: declaration.credentialSource,
    lockScope: declaration.lockScope,
    replaySemantics: declaration.replaySemantics,
    auditEvidence: [...declaration.auditEvidence],
    auditIdentity: `provider-capability:${opts.capabilityId}:${opts.phase}`,
    rollbackProcedure: [...declaration.rollbackProcedure],
    smokeEvidence: opts.phase === "smoke",
    hook: {
      adapter: adapter.name,
      automated: adapter.automated,
      manualPrerequisite: adapter.manualPrerequisite === true,
    },
    output,
    ...(result.payload ? { providerPayload: result.payload } : {}),
  };
}

export function assertSupportedPhase(
  phase: string,
): asserts phase is CloudProviderCapabilityHookPhase {
  if (!CLOUD_PROVIDER_CAPABILITY_HOOK_PHASES.includes(phase as CloudProviderCapabilityHookPhase)) {
    throw new Error(`unsupported provider-capability hook phase ${phase}`);
  }
}

function concreteDeclaration(id: string): ProviderCapabilityDeclaration {
  try {
    return capabilityDeclaration(id);
  } catch {
    throw new Error(`unknown provider-capability ${id}`);
  }
}

function assertValidDeclaration(declaration: ProviderCapabilityDeclaration): void {
  const errors = validateProviderCapabilityDeclaration(declaration);
  if (!declaration.credentialSource.trim())
    errors.push(`${declaration.id}: missing credential source`);
  if (!declaration.lockScope.trim()) errors.push(`${declaration.id}: missing lock scope`);
  if (declaration.auditEvidence.length === 0) {
    errors.push(`${declaration.id}: missing audit evidence refs`);
  }
  if (errors.length > 0) {
    throw new Error(`provider-capability hook rejected: ${errors.join("; ")}`);
  }
}

function hookOutput(
  adapterName: string,
  phase: CloudProviderCapabilityHookPhase,
  deploymentLabel: string,
  declaration: ProviderCapabilityDeclaration,
): string {
  const mode =
    declaration.id === "supabase-privatelink-prerequisite"
      ? "support-mediated evidence gate"
      : "reviewed provider hook";
  return [
    `${mode} ${phase}`,
    `adapter=${adapterName}`,
    `capability=${declaration.id}`,
    `deployment=${deploymentLabel}`,
    `lockScope=${declaration.lockScope}`,
    `auditEvidence=${declaration.auditEvidence.join(",")}`,
  ].join(" ");
}

function reviewedAdapter(name: string, automated = true, manualPrerequisite = false): HookAdapter {
  const phase = (selectedPhase: CloudProviderCapabilityHookPhase): HookAdapterPhase => {
    return async (opts) => ({
      summary: `${name} ${selectedPhase}`,
      rawOutput: hookOutput(name, selectedPhase, opts.deploymentLabel, opts.declaration),
    });
  };
  return {
    name,
    automated,
    manualPrerequisite,
    preview: phase("preview"),
    apply: phase("apply"),
    evidence: phase("evidence"),
    smoke: phase("smoke"),
    rollback: phase("rollback"),
  };
}
