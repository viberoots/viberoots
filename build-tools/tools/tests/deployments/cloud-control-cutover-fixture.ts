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
      "aws-ec2-control-plane-host": capabilityEvidence(),
      "aws-network-foundation": capabilityEvidence(),
      "aws-s3-artifact-store": capabilityEvidence(),
      "supabase-managed-postgres": capabilityEvidence(),
      "supabase-privatelink-prerequisite": capabilityEvidence(),
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

export function capabilityEvidence() {
  return { auditIdentity: "operator-1", rollbackProcedure: true, smokeEvidence: true };
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
