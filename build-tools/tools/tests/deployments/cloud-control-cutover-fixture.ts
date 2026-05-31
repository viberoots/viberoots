import { capabilityDeclaration } from "../../deployments/cloud-control-setup-contract";
import { foundationFromTopology } from "./cloud-control-aws-foundation-fixture";
import {
  CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SCHEMA,
  CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SOURCE,
} from "../../deployments/cloud-control-provider-capability-hook-contract";
import { managedDependencyEvidence } from "./cloud-control-cutover-managed-dependencies.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { ingressCommandEvidence } from "./cloud-control-aws-ingress.fixture";
import {
  freshCheckedAt,
  IMAGE_BUILD_IDENTITY,
  IMAGE_DIGEST,
  IMAGE_REF,
  privateLinkAwsTopology,
  topologyForPublishedImage,
} from "./cloud-control-aws-topology.fixture";

export { managedDependencyEvidence } from "./cloud-control-cutover-managed-dependencies.fixture";
export { foundationFromTopology } from "./cloud-control-aws-foundation-fixture";
export {
  IMAGE_BUILD_IDENTITY,
  IMAGE_DIGEST,
  IMAGE_REF,
  privateLinkAwsTopology,
  publicAwsTopology,
  topologyForPublishedImage,
} from "./cloud-control-aws-topology.fixture";

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
    imagePublication: imagePublicationEvidence(),
    managedDependencies: managedDependencyEvidence(),
    awsTopology: privateLinkAwsTopology(),
    latestNonProductionDeployment: {
      runId: "deploy-run-1",
      hostProfile: "aws-ec2",
      image: IMAGE_REF,
      publicUrl: "https://deploy.example.test",
      trafficIngressHostProfile: "aws-ec2",
      cloudPrimaryPath: true,
      stagingDeploymentSucceeded: true,
    },
    runtimeConfig: {
      publicUrl: "https://deploy.example.test",
      authProvider: {
        callback: {
          externalHost: "deploy-auth.example.test",
          externalPath: "/oidc/callback",
        },
      },
    },
    ingressCommandEvidence: ingressCommandEvidence(),
    providerCapabilities: {
      "aws-ec2-control-plane-host": capabilityEvidence("aws-ec2-control-plane-host"),
      "aws-network-foundation": capabilityEvidence("aws-network-foundation"),
      "aws-ecr-control-plane-registry": capabilityEvidence("aws-ecr-control-plane-registry"),
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

export function imagePublicationEvidence(overrides: Record<string, unknown> = {}) {
  return {
    image: IMAGE_REF,
    sourceRevision: "source-cutover",
    imageBuildIdentity: IMAGE_BUILD_IDENTITY,
    digest: IMAGE_DIGEST,
    inspectedDigest: IMAGE_DIGEST,
    tag: "registry.example.com/platform/deployment-control-plane:source-cutover",
    registryProfile: ecrRegistryProfileForImage(IMAGE_REF, IMAGE_DIGEST),
    ...overrides,
  };
}

export function capabilityEvidence(id = "aws-ec2-control-plane-host") {
  const declaration = capabilityDeclaration(id);
  return {
    schemaVersion: CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SCHEMA,
    source: CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SOURCE,
    checkedAt: freshCheckedAt(),
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
    ...providerPayloadFor(id),
  };
}

function providerPayloadFor(id: string) {
  if (id === "aws-network-foundation") {
    return {
      providerPayload: {
        schemaVersion: "aws-foundation-hook-payload@1",
        ingressLifecycle: {
          schemaVersion: "aws-ingress-lifecycle-evidence@1",
          operation: {
            evidencePayload: { schemaVersion: "aws-ingress-hook-inspection@1" },
          },
        },
      },
    };
  }
  if (id === "supabase-privatelink-prerequisite") {
    return {
      providerPayload: {
        schemaVersion: "supabase-privatelink-provider-payload@1",
        evidenceMode: "evidence-only",
        supportMediated: true,
        supportEvidenceRef: "privatelink-request",
        ramPermissionEvidenceRef: "ram-acceptance-permission",
        latticePermissionEvidenceRef: "vpc-lattice-association-permission",
        privateDnsEvidenceRef: "private-dns-proof",
      },
    };
  }
  if (id !== "cloudflare-edge" && id !== "vercel-operator-ui") return {};
  return {
    providerPayload: {
      schemaVersion: "edge-ingress-provider-payload@1",
      hostname: "deploy.example.test",
      callbackHost: "deploy-auth.example.test",
      callbackPath: "/oidc/callback",
      originLoadBalancerArn:
        "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/cp/1",
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
