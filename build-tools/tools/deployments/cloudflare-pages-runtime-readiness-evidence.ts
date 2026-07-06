#!/usr/bin/env zx-wrapper
import { cloudflarePagesCredentialStagingEvidence } from "./cloudflare-pages-runtime-credential-evidence";

const IMAGE_DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE_REF = `registry.example.com/platform/deployment-control-plane@${IMAGE_DIGEST}`;
export const IMAGE_BUILD_IDENTITY = `nix-source-${"b".repeat(64)}`;
const HOST_PROFILE = "cloudflare-pages-control-plane";
const SOURCE_HOST = "cloudflare-pages-control-plane-reconciler";

export function cloudflarePagesReadinessEvidence(deploymentId: string, checkedAt: string) {
  const op = operationEnvelope(checkedAt);
  return {
    schemaVersion: "cloud-cutover-evidence@1",
    operationIdentity: { operation: "cutover", sourceHost: SOURCE_HOST, checkedAt },
    hostProfile: HOST_PROFILE,
    region: "us-east-1",
    generatedAt: checkedAt,
    checkedAt,
    sourceHost: SOURCE_HOST,
    imageDigest: IMAGE_REF,
    configDigest: "sha256:config",
    expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
    selectedProviderCapabilities: [],
    health: runtimeHealth(deploymentId, checkedAt),
    runtimeConfig: runtimeConfig(deploymentId),
    latestNonProductionDeployment: latestDeployment(deploymentId),
    imagePublication: imagePublication(),
    managedDependencies: managedDependencies(checkedAt),
    credentialManifestDigest: "sha256:credential-manifest",
    credentialMapDigest: "sha256:credential-map",
    credentialManifestRequiredFiles: ["runtime.env"],
    credentialStaging: cloudflarePagesCredentialStagingEvidence(checkedAt),
    standby: { ...op, mode: "service-only" },
    audit: { cutover: true },
  };
}

function runtimeHealth(deploymentId: string, checkedAt: string) {
  return {
    cloudHealth: runtimeHttp("health", deploymentId, checkedAt),
    readiness: runtimeHttp("readiness", deploymentId, checkedAt),
    workerHeartbeats: runtimeHttp("worker-heartbeats", deploymentId, checkedAt),
    databaseConnectivity: true,
    artifactStoreCompatibility: true,
    authCallbackReachability: true,
    uiReads: runtimeHttp("health", deploymentId, checkedAt),
    mcpReads: runtimeHttp("readiness", deploymentId, checkedAt),
  };
}

function runtimeHttp(check: string, deploymentId: string, checkedAt: string) {
  const readiness = check === "readiness";
  const workers = check === "worker-heartbeats";
  return {
    schemaVersion: "cloud-control-runtime-http-evidence@1",
    check,
    checkedAt,
    url: `https://deploy.example.test/${
      readiness ? "readyz" : workers ? "api/v1/worker-heartbeats" : "healthz"
    }`,
    host: "deploy.example.test",
    expected: runtimeHttpExpected(deploymentId),
    credentialSource: workers
      ? { kind: "token_file", tokenFile: "control-plane-token" }
      : { kind: "none" },
    status: { ok: true, httpStatus: 200 },
    dependencies: readiness ? readinessDeps() : undefined,
    body: workers ? workerBody(checkedAt) : readiness ? readinessBody() : healthBody(),
  };
}

function runtimeConfig(deploymentId: string) {
  return {
    publicUrl: "https://deploy.example.test",
    deploymentIds: [deploymentId],
    workers: { expectedCount: 1 },
    authProvider: {
      callback: { externalHost: "deploy-auth.example.test", externalPath: "/oidc/callback" },
    },
  };
}

function latestDeployment(deploymentId: string) {
  return {
    runId: "deploy-run-1",
    deploymentId,
    hostProfile: HOST_PROFILE,
    image: IMAGE_REF,
    publicUrl: "https://deploy.example.test",
    trafficIngressHostProfile: HOST_PROFILE,
    cloudPrimaryPath: true,
    stagingDeploymentSucceeded: true,
  };
}

function imagePublication() {
  return {
    image: IMAGE_REF,
    sourceRevision: "source-runtime-evidence",
    imageBuildIdentity: IMAGE_BUILD_IDENTITY,
    digest: IMAGE_DIGEST,
    inspectedDigest: IMAGE_DIGEST,
    tag: "registry.example.com/platform/deployment-control-plane:source-runtime-evidence",
  };
}

function managedDependencies(checkedAt: string) {
  return {
    schemaVersion: "control-plane-managed-dependency-evidence@1",
    profileName: "cloudflare-pages-control-plane",
    checkedAt,
    runtimePath: {
      hostProfile: HOST_PROFILE,
      awsRegion: "us-east-1",
      databaseConnectivityMode: "public",
      artifactCredentialMode: "files",
    },
    postgres: {
      checkedFeatures: ["pg_graphql"],
      databaseConnectivityMode: "public",
      tlsEnabled: true,
    },
    artifactStore: { checkedOperations: ["PUT", "GET", "HEAD"], digest: "sha256:artifact-store" },
  };
}

function operationEnvelope(checkedAt: string) {
  return {
    operationIdentity: evidenceRef("standby", checkedAt),
    sourceHost: SOURCE_HOST,
    hostProfile: HOST_PROFILE,
    checkedAt,
    imageDigest: IMAGE_REF,
    configDigest: "sha256:config",
    credentialManifestDigest: "sha256:credential-manifest",
    serviceMode: evidenceRef("service-mode", checkedAt),
    workerMode: evidenceRef("worker-mode", checkedAt),
    doubleExecutionPrevention: evidenceRef("double-execution", checkedAt),
  };
}

function runtimeHttpExpected(deploymentId: string) {
  return {
    publicUrl: "https://deploy.example.test",
    hostProfile: HOST_PROFILE,
    profileIdentity: SOURCE_HOST,
    deploymentIds: [deploymentId],
    workerCount: 1,
  };
}

function readinessDeps() {
  return {
    database: { ok: true },
    artifactStore: { ok: true },
    workerQueueLocks: { ok: true },
    runtimeConfig: { ok: true, profileIdentity: SOURCE_HOST },
  };
}

function workerBody(checkedAt: string) {
  return {
    workers: [
      {
        workerId: "worker-1",
        instanceId: SOURCE_HOST,
        status: "running",
        lastSeenAt: checkedAt,
      },
    ],
  };
}

function readinessBody() {
  return { ok: true, runtimeConfig: { ok: true, profileIdentity: SOURCE_HOST } };
}

function healthBody() {
  return { ok: true, instanceId: SOURCE_HOST };
}

function evidenceRef(name: string, checkedAt: string) {
  return {
    schemaVersion: "cloud-cutover-evidence-ref@1",
    evidenceRef: `evidence://cloudflare-pages/${name}`,
    checkedAt,
    sourceHost: SOURCE_HOST,
  };
}
