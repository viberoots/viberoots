import { capabilityDeclaration } from "../../deployments/cloud-control-setup-contract";
import { foundationFromTopology } from "./cloud-control-aws-foundation-fixture";
import {
  CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SCHEMA,
  CLOUD_PROVIDER_CAPABILITY_HOOK_EVIDENCE_SOURCE,
} from "../../deployments/cloud-control-provider-capability-hook-contract";
import { managedDependencyEvidence } from "./cloud-control-cutover-managed-dependencies.fixture";
import { reviewedSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-profile";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { ingressCommandEvidence } from "./cloud-control-aws-ingress.fixture";
import {
  liveCredentialStagingEvidence,
  CUTOVER_CREDENTIAL_FILES,
} from "./cloud-control-credential-staging.fixture";
import { restoreEvidence } from "./cloud-control-cutover-restore.fixture";
import {
  freshCheckedAt,
  IMAGE_BUILD_IDENTITY,
  IMAGE_DIGEST,
  IMAGE_REF,
  privateLinkAwsTopology,
  topologyForPublishedImage,
} from "./cloud-control-aws-topology.fixture";
import { evidenceRef, operationEnvelope } from "./cloud-control-cutover-operation.fixture";
import { providerPayloadFor } from "./cloud-control-cutover-provider-payload.fixture";
import { RUNTIME_HTTP_SCHEMA } from "../../deployments/cloud-control-runtime-http-evidence";

export { managedDependencyEvidence } from "./cloud-control-cutover-managed-dependencies.fixture";
export { foundationFromTopology } from "./cloud-control-aws-foundation-fixture";
export { restoreEvidence } from "./cloud-control-cutover-restore.fixture";
export {
  IMAGE_BUILD_IDENTITY,
  IMAGE_DIGEST,
  IMAGE_REF,
  privateLinkAwsTopology,
  publicAwsTopology,
  topologyForPublishedImage,
} from "./cloud-control-aws-topology.fixture";

export function evidence(overrides: Record<string, unknown> = {}) {
  const credentialManifestDigest = "sha256:credential-manifest";
  const credentialMapDigest = "sha256:credential-map";
  const commonOperation = operationEnvelope(credentialManifestDigest);
  return {
    schemaVersion: "cloud-cutover-evidence@1",
    operationIdentity: {
      operation: "cutover",
      sourceHost: "aws-ec2-instance-i-123",
      checkedAt: new Date().toISOString(),
    },
    hostProfile: "aws-ec2",
    region: "us-east-1",
    generatedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    sourceHost: "aws-ec2-instance-i-123",
    imageDigest: IMAGE_REF,
    configDigest: "sha256:config",
    expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
    selectedProviderCapabilities: [
      "aws-ec2-control-plane-host",
      "aws-network-foundation",
      "aws-ecr-control-plane-registry",
      "aws-s3-artifact-store",
      "supabase-managed-postgres",
      "supabase-privatelink-prerequisite",
    ],
    health: {
      cloudHealth: runtimeHttpEvidence("health"),
      readiness: runtimeHttpEvidence("readiness"),
      workerHeartbeats: runtimeHttpEvidence("worker-heartbeats"),
      databaseConnectivity: true,
      artifactStoreCompatibility: true,
      authCallbackReachability: true,
      uiReads: runtimeHttpEvidence("health"),
      mcpReads: runtimeHttpEvidence("readiness"),
    },
    expectedWorkerCount: 2,
    imagePublication: imagePublicationEvidence(),
    managedDependencies: managedDependencyEvidence(),
    supabasePostgresProfile: reviewedSupabaseManagedPostgresProfile({
      instanceId: "cloud-control-plane",
      region: "us-east-1",
      mode: "privatelink",
      organizationId: "org-control-plane-prod",
      projectRef: "project-review",
    }),
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
      deploymentIds: ["pleomino-staging"],
      workers: { expectedCount: 2 },
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
    credentialManifestDigest,
    credentialMapDigest,
    credentialManifestRequiredFiles: [...CUTOVER_CREDENTIAL_FILES],
    credentialStaging: liveCredentialStagingEvidence(credentialManifestDigest, credentialMapDigest),
    standby: {
      ...commonOperation,
      mode: "service-only",
      serviceMode: evidenceRef("standby/service-only"),
      workerMode: evidenceRef("standby/workers-disabled"),
      doubleExecutionPrevention: evidenceRef("standby/no-double-execution"),
    },
    restore: restoreEvidence(commonOperation),
    rollback: {
      ...commonOperation,
      previousHostProfile: evidenceRef("rollback/previous-host"),
      trafficTarget: evidenceRef("rollback/traffic-target"),
      standbyServiceMode: evidenceRef("rollback/standby-service"),
      workerDrain: evidenceRef("rollback/worker-drain"),
      providerLocks: evidenceRef("rollback/provider-locks"),
      inFlightQueuePosture: evidenceRef("rollback/queue-posture"),
      doubleExecutionPrevention: evidenceRef("rollback/no-double-execution"),
    },
    breakGlass: {
      ...commonOperation,
      incidentRef: "incident://cutover-test",
      statusInspect: evidenceRef("break-glass/status"),
      workerFreeze: evidenceRef("break-glass/freeze"),
      auditPreserved: evidenceRef("break-glass/audit"),
      providerMutationBlocked: evidenceRef("break-glass/provider-block"),
      incidentBoundedAccess: evidenceRef("break-glass/access-window"),
    },
    audit: { cutover: true, rollback: true, restore: true, "break-glass": true },
    ...overrides,
  };
}

export function runtimeHttpEvidence(check: "health" | "readiness" | "worker-heartbeats") {
  const body =
    check === "worker-heartbeats"
      ? { workers: [workerHeartbeat("worker-1"), workerHeartbeat("worker-2")] }
      : check === "readiness"
        ? {
            ok: true,
            database: { ok: true },
            artifactStore: { ok: true },
            workerQueueLocks: { ok: true },
            runtimeConfig: { ok: true, profileIdentity: "aws-ec2-instance-i-123" },
          }
        : { ok: true, instanceId: "aws-ec2-instance-i-123" };
  return {
    schemaVersion: RUNTIME_HTTP_SCHEMA,
    check,
    checkedAt: new Date().toISOString(),
    url: `https://deploy.example.test/${
      check === "health" ? "healthz" : check === "readiness" ? "readyz" : "api/v1/worker-heartbeats"
    }`,
    host: "deploy.example.test",
    expected: {
      publicUrl: "https://deploy.example.test",
      host: "deploy.example.test",
      hostProfile: "aws-ec2",
      profileIdentity: "aws-ec2-instance-i-123",
      deploymentIds: ["pleomino-staging"],
      workerCount: 2,
    },
    credentialSource:
      check === "worker-heartbeats"
        ? {
            kind: "token_file",
            tokenFile: "control-plane-token",
            credentialRootEnv: "CREDENTIAL_DIR",
          }
        : { kind: "none" },
    status: { ok: true, httpStatus: 200 },
    ...(check === "readiness"
      ? {
          dependencies: {
            database: { ok: true },
            artifactStore: { ok: true },
            workerQueueLocks: { ok: true },
            runtimeConfig: { ok: true, profileIdentity: "aws-ec2-instance-i-123" },
          },
        }
      : {}),
    body,
  };
}

function workerHeartbeat(workerId: string) {
  return {
    workerId,
    instanceId: "aws-ec2-instance-i-123",
    status: "running",
    lastSeenAt: new Date().toISOString(),
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
