import { capabilityDeclaration } from "../../deployments/cloud-control-setup-contract";
import {
  CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SCHEMA,
  CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SOURCE,
} from "../../deployments/cloud-control-provider-capability-hook-contract";

export function evidence(overrides: Record<string, unknown> = {}) {
  return {
    hostProfile: "aws-ec2",
    region: "us-east-1",
    generatedAt: new Date().toISOString(),
    health: {
      cloudHealth: true,
      readiness: true,
      workerHeartbeats: 2,
      databaseConnectivity: true,
      artifactStoreCompatibility: true,
      authCallbackReachability: true,
      uiReads: true,
      mcpReads: true,
    },
    awsTopology: {
      artifactBackend: "aws-s3",
      region: "us-east-1",
      vpcId: "vpc-123",
      subnetVpcId: "vpc-123",
      securityGroupVpcId: "vpc-123",
      subnets: ["subnet-123"],
      securityGroups: ["sg-123"],
      databaseConnectivity: "privatelink",
      supabasePrivatelink: true,
      s3VpcEndpoint: true,
      albNlbHealth: true,
      tlsHealth: true,
      dnsHealth: true,
    },
    latestNonProductionDeployment: {
      runId: "deploy-run-1",
      hostProfile: "aws-ec2",
      trafficIngressHostProfile: "aws-ec2",
      cloudPrimaryPath: true,
      stagingDeploymentSucceeded: true,
    },
    providerCapabilities: {
      "aws-ec2-control-plane-host": capabilityEvidence("aws-ec2-control-plane-host"),
      "aws-network-foundation": capabilityEvidence("aws-network-foundation"),
      "aws-s3-artifact-store": capabilityEvidence("aws-s3-artifact-store"),
      "supabase-managed-postgres": capabilityEvidence("supabase-managed-postgres"),
      "supabase-privatelink-prerequisite": capabilityEvidence("supabase-privatelink-prerequisite"),
    },
    standby: { mode: "service-only", doubleExecutionPrevented: true },
    restore: restoreEvidence(),
    rollback: { trafficReturn: true, authoritySemanticsUnchanged: true },
    breakGlass: {
      statusInspect: true,
      pauseWorkers: true,
      auditPreserved: true,
      providerMutationBlocked: true,
    },
    audit: { cutover: true, rollback: true, restore: true, "break-glass": true },
    ...overrides,
  };
}

export function capabilityEvidence(id = "aws-ec2-control-plane-host") {
  const declaration = capabilityDeclaration(id);
  return {
    schemaVersion: CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SCHEMA,
    source: CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SOURCE,
    capabilityId: id,
    phase: "smoke",
    declaration,
    auditEvidence: [...declaration.auditEvidence],
    auditIdentity: "operator-1",
    rollbackProcedure: true,
    smokeEvidence: true,
    hook: { adapter: "fixture-reviewed-hook", automated: true, manualPrerequisite: false },
    output: {
      classification: "redact_before_display",
      redacted: true,
      summary: "payload redacted (sha256:fixture)",
      fingerprint: "sha256:fixture",
    },
  };
}

export function restoreEvidence() {
  return {
    databaseRecords: true,
    artifactObjects: true,
    imageDigest: true,
    config: true,
    exportedConfigDigest: "sha256:config",
    credentialManifest: true,
    authConfiguration: true,
    durableStateReferences: ["submission:1", "artifact:1"],
  };
}
