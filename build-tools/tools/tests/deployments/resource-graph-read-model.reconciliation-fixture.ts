#!/usr/bin/env zx-wrapper
import { createDeploymentResourceGraphDocuments } from "../../deployments/resource-graph-export";

export const POLICY_REFS = [
  policyRef(
    "ProviderCapabilityPolicy",
    "provider-capability:cloudflare-pages",
    "provider-capability@1",
  ),
  policyRef("AdmissionPolicy", "//demo:admission", "sha256:admission"),
];

export const PROVISIONER_POLICY_REFS = [
  policyRef("ProviderCapabilityPolicy", "provider-capability:opentofu", "provider-capability@1"),
  policyRef("AdmissionPolicy", "//demo:opentofu-admission", "sha256:opentofu-admission"),
];

export const RELEASE_POLICY_REFS = [
  policyRef(
    "ProviderCapabilityPolicy",
    "provider-capability:nixos-shared-host",
    "provider-capability@1",
  ),
  policyRef("ReleaseActionPolicy", "//demo:release/cache-warmup:policy", "sha256:release-action"),
];

export function fixtureDocuments() {
  return createDeploymentResourceGraphDocuments({
    apiVersion: "deployment-resource-envelope-list@1",
    inventory: {} as any,
    errors: [],
    envelopes: [
      envelope("Deployment", "demo-web", "uid:deployment", [], {
        selectedControlPlane: { profile: "shared-cloudflare", serviceClientSource: "context" },
        localOverrideEvidence: [{ path: "controlPlanes.shared.token", localToken: "local-secret" }],
        sourceModeEvidence: ["remote-store", "local-self", "local-sibling-submodule"],
        releaseActions: { cloudflarePages: "unsupported-negative-only" },
      }),
      envelope("ProviderTarget", "cloudflare-pages:web-platform/demo-web", "uid:provider", [
        "uid:deployment",
      ]),
      envelope(
        "DeploymentTargetException",
        "target-exception:cf-target-migration",
        "uid:target-exception",
        ["uid:deployment"],
        {
          exceptionKind: "provider_target_transition",
          effectiveAt: "2026-07-05T12:00:00.000Z",
          policyResourceRefs: POLICY_REFS,
        },
      ),
      envelope("Deployment", "demo-infra", "uid:infra-deployment", [], {}),
      envelope("Provisioner", "demo-infra:provisioner", "uid:provisioner", [
        "uid:infra-deployment",
      ]),
      envelope("Deployment", "demo-release", "uid:release-deployment", [], {}),
      envelope("ProviderTarget", "nixos-shared-host:default:demo-release", "uid:release-provider", [
        "uid:release-deployment",
      ]),
      ...policyEnvelopes(),
    ],
  });
}

export function sourcePlans() {
  return [
    {
      target: "//demo:deploy",
      nixpkgs_profile: "cloudflare_profile",
      nixpkg_pins: { "pkgs.nodejs": { nixpkgs_profile: "nixpkgs_24_05" } },
      sourcePlanRef: "source-plan:local-selected",
      cacheManifestRef: "cache-manifest:remote-snapshot",
    },
  ];
}

export function cloudflareRecord() {
  return {
    deployRunId: "run-1",
    deploymentId: "demo-web",
    provider: "cloudflare-pages",
    providerTargetIdentity: "cloudflare-pages:web-platform/demo-web",
    providerReleaseId: "cf-pages-release-1",
    previewTarget: "https://preview.demo.pages.dev",
    finalOutcome: "succeeded",
    publishMode: "normal",
    smokeOutcome: "passed",
    artifactIdentity: "artifact-1",
    admittedContext: {
      sourcePlanRef: "source-plan:local-selected",
      policyEvaluation: { policyResourceRefs: POLICY_REFS },
    },
  };
}

export function provisionerRecord() {
  return {
    deployRunId: "run-2",
    deploymentId: "demo-infra",
    provider: "opentofu",
    finalOutcome: "succeeded",
    provisionerPlan: {
      artifactPath: "/tmp/opentofu/plan.bin",
      fingerprint: "sha256:provisioner-plan",
    },
    admittedContext: { policyEvaluation: { policyResourceRefs: PROVISIONER_POLICY_REFS } },
  };
}

export function releaseActionRecord() {
  return {
    deployRunId: "run-3",
    deploymentId: "demo-release",
    provider: "nixos-shared-host",
    providerTargetIdentity: "nixos-shared-host:default:demo-release",
    operationKind: "rollback",
    finalOutcome: "succeeded",
    releaseActionResults: [{ ref: "//demo:release/cache-warmup", status: "succeeded" }],
    admittedContext: { policyEvaluation: { policyResourceRefs: RELEASE_POLICY_REFS } },
  };
}

export function cloudflareStageState() {
  return {
    ...cloudflareRecord(),
    environmentStage: "staging",
    currentRunId: "run-1",
    retainedArtifactEvidence: [{ identity: "artifact-1" }],
  };
}

export function provisionerStageState() {
  return {
    ...provisionerRecord(),
    environmentStage: "staging",
    currentRunId: "run-2",
    retainedRenderEvidence: [
      { kind: "provisioner_plan", referencePath: "/tmp/opentofu/plan.bin" },
      { kind: "execution_snapshot", referencePath: "/tmp/execution-snapshot.json" },
    ],
  };
}

function policyEnvelopes() {
  return [...POLICY_REFS, ...PROVISIONER_POLICY_REFS, ...RELEASE_POLICY_REFS].map((ref) =>
    envelope(ref.kind, ref.resourceId, `uid:policy:${ref.resourceId}`, [], {
      policyResourceVersion: ref.version,
      failClosed: true,
    }),
  );
}

function envelope(kind: string, name: string, uid: string, owners: string[], facts: any = {}) {
  return {
    apiVersion: "deployment.resource.viberoots.dev/v1",
    kind,
    metadata: {
      name,
      uid,
      labels: { "viberoots.dev/authority": "reviewed_intent" },
      ownerReferences: owners.map((owner) => ({ kind: "Deployment", uid: owner })),
    },
    spec: facts,
    policyRefs: [],
    source: { class: "buck", label: "//demo:deploy" },
  } as any;
}

function policyRef(kind: string, resourceId: string, version: string) {
  return { kind, resourceId, version };
}
