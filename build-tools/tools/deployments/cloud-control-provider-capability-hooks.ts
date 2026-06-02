import { redactOperatorText } from "./deployment-control-plane-redaction";
import { capabilityDeclaration } from "./cloud-control-setup-contract";
import type { ProviderCapabilityDeclaration } from "./cloud-control-setup-types";
import { validateProviderCapabilityDeclaration } from "./cloud-control-setup-validate";
import { awsEc2HostHookAdapter } from "./cloud-control-aws-ec2-host-hooks";
import {
  CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SCHEMA,
  CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SOURCE,
} from "./cloud-control-provider-capability-hook-contract";
import { awsFoundationHookAdapter } from "./cloud-control-aws-foundation-hooks";
import type { AwsFoundationProfile } from "./cloud-control-aws-foundation-types";
import type { AwsTopologyEvidence } from "./cloud-control-aws-topology-types";
import { supabaseManagedPostgresAdapter } from "./cloud-control-supabase-postgres-hooks";
import type { SupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-profile";
import { awsEcrRegistryHookAdapter } from "./cloud-control-aws-ecr-registry-hooks";
import type { ControlPlaneRegistryProfile } from "./control-plane-registry-profile";
import type { ControlPlaneImagePublicationEvidence } from "./control-plane-image-publication";
import { supabasePrivateLinkAdapter } from "./cloud-control-supabase-privatelink-hooks";
import type { SupabasePrivateLinkIacBundle } from "./cloud-control-supabase-privatelink-iac-evidence";
import type { Ec2AsgIacBundle } from "./cloud-control-aws-ec2-asg-iac-evidence";
import type { Ec2HostMode } from "./cloud-control-aws-ec2-host-mode";
import { remainingCapabilityHookAdapter } from "./cloud-control-remaining-capability-hooks";

export const CLOUD_PROVIDER_CAPABILITY_HOOK_PHASES = [
  "preview",
  "apply",
  "evidence",
  "smoke",
  "rollback",
  "reviewed-import",
] as const;

export type CloudProviderCapabilityHookPhase =
  (typeof CLOUD_PROVIDER_CAPABILITY_HOOK_PHASES)[number];

export type HookAdapter = {
  name: string;
  automated: boolean;
  manualPrerequisite?: boolean;
  preview: HookAdapterPhase;
  apply: HookAdapterPhase;
  evidence: HookAdapterPhase;
  smoke: HookAdapterPhase;
  rollback: HookAdapterPhase;
  reviewedImport: HookAdapterPhase;
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
  awsEc2Profile?: Record<string, unknown>;
  expectedEc2HostMode?: Ec2HostMode;
  ec2AsgIac?: Ec2AsgIacBundle;
  awsFoundationInspection?: AwsFoundationProfile;
  awsTopologyEvidence?: AwsTopologyEvidence;
  supabasePostgresProfile?: SupabaseManagedPostgresProfile;
  registryProfile?: ControlPlaneRegistryProfile;
  imagePublication?: ControlPlaneImagePublicationEvidence;
  supabasePrivateLinkIac?: SupabasePrivateLinkIacBundle;
  awsAtticCacheEvidence?: Record<string, unknown>;
  cloudflareEdgeEvidence?: Record<string, unknown>;
  vercelOperatorUiEvidence?: Record<string, unknown>;
  remoteBuildWorkerFleetEvidence?: Record<string, unknown>;
};

const HOOK_ADAPTERS: Record<string, HookAdapter> = {
  "aws-ec2-control-plane-host": awsEc2HostHookAdapter(),
  "aws-attic-cache-service": remainingCapabilityHookAdapter("aws-attic-cache-service"),
  "aws-ecr-control-plane-registry": awsEcrRegistryHookAdapter(),
  "aws-s3-artifact-store": awsFoundationHookAdapter("aws-s3-artifact-store"),
  "aws-network-foundation": awsFoundationHookAdapter("aws-network-foundation"),
  "supabase-managed-postgres": supabaseManagedPostgresAdapter(
    reviewedAdapter("supabase-managed-postgres-evidence-gate", false, true),
  ),
  "supabase-privatelink-prerequisite": supabasePrivateLinkAdapter(
    reviewedAdapter("supabase-privatelink-evidence-gate", false, true),
  ),
  "cloudflare-edge": remainingCapabilityHookAdapter("cloudflare-edge"),
  "vercel-operator-ui": remainingCapabilityHookAdapter("vercel-operator-ui"),
  "remote-build-worker-fleet": remainingCapabilityHookAdapter("remote-build-worker-fleet"),
};

export async function runCloudProviderCapabilityHook(opts: {
  capabilityId: string;
  phase: CloudProviderCapabilityHookPhase;
  deploymentLabel: string;
  targetIdentity?: string;
  declaration?: ProviderCapabilityDeclaration;
  awsEc2Profile?: Record<string, unknown>;
  expectedEc2HostMode?: Ec2HostMode;
  ec2AsgIac?: Ec2AsgIacBundle;
  awsFoundationInspection?: AwsFoundationProfile;
  awsTopologyEvidence?: AwsTopologyEvidence;
  supabasePostgresProfile?: SupabaseManagedPostgresProfile;
  registryProfile?: ControlPlaneRegistryProfile;
  imagePublication?: ControlPlaneImagePublicationEvidence;
  supabasePrivateLinkIac?: SupabasePrivateLinkIacBundle;
  awsAtticCacheEvidence?: Record<string, unknown>;
  cloudflareEdgeEvidence?: Record<string, unknown>;
  vercelOperatorUiEvidence?: Record<string, unknown>;
  remoteBuildWorkerFleetEvidence?: Record<string, unknown>;
}) {
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
  const result = await hookAdapterPhase(
    adapter,
    opts.phase,
  )({
    phase: opts.phase,
    deploymentLabel: opts.deploymentLabel,
    declaration,
    ...(opts.awsEc2Profile ? { awsEc2Profile: opts.awsEc2Profile } : {}),
    ...(opts.expectedEc2HostMode ? { expectedEc2HostMode: opts.expectedEc2HostMode } : {}),
    ...(opts.ec2AsgIac ? { ec2AsgIac: opts.ec2AsgIac } : {}),
    ...(opts.awsFoundationInspection
      ? { awsFoundationInspection: opts.awsFoundationInspection }
      : {}),
    ...(opts.awsTopologyEvidence ? { awsTopologyEvidence: opts.awsTopologyEvidence } : {}),
    ...(opts.supabasePostgresProfile
      ? { supabasePostgresProfile: opts.supabasePostgresProfile }
      : {}),
    ...(opts.registryProfile ? { registryProfile: opts.registryProfile } : {}),
    ...(opts.imagePublication ? { imagePublication: opts.imagePublication } : {}),
    ...(opts.supabasePrivateLinkIac ? { supabasePrivateLinkIac: opts.supabasePrivateLinkIac } : {}),
    ...(opts.awsAtticCacheEvidence ? { awsAtticCacheEvidence: opts.awsAtticCacheEvidence } : {}),
    ...(opts.cloudflareEdgeEvidence ? { cloudflareEdgeEvidence: opts.cloudflareEdgeEvidence } : {}),
    ...(opts.vercelOperatorUiEvidence
      ? { vercelOperatorUiEvidence: opts.vercelOperatorUiEvidence }
      : {}),
    ...(opts.remoteBuildWorkerFleetEvidence
      ? { remoteBuildWorkerFleetEvidence: opts.remoteBuildWorkerFleetEvidence }
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

function hookAdapterPhase(adapter: HookAdapter, phase: CloudProviderCapabilityHookPhase) {
  return phase === "reviewed-import" ? adapter.reviewedImport : adapter[phase];
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
    reviewedImport: phase("reviewed-import"),
  };
}
