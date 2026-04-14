#!/usr/bin/env zx-wrapper
import {
  SERVICE_COMPONENT_KIND,
  THIRD_PARTY_SERVICE_COMPONENT_KIND,
} from "../deployment-component-kinds.ts";
import { KUBERNETES_PROVIDER } from "../deployment-provider-targets.ts";
import type { DeploymentProviderCapability } from "./types.ts";
import { bullet } from "./types.ts";

export const KUBERNETES_PROVIDER_CAPABILITY: DeploymentProviderCapability = {
  provider: KUBERNETES_PROVIDER,
  supportedComponentKinds: [SERVICE_COMPONENT_KIND, THIRD_PARTY_SERVICE_COMPONENT_KIND],
  multiComponentKinds: [SERVICE_COMPONENT_KIND, THIRD_PARTY_SERVICE_COMPONENT_KIND],
  supportedRolloutModes: ["all_at_once", "ordered_best_effort"],
  defaultRolloutMode: "all_at_once",
  canonicalTargetIdentity: {
    fields: ["`cluster`", "`namespace`", "`release`"],
    lockKeyShape: [bullet("`kubernetes:<cluster>/<namespace>/<release>`")],
  },
  componentSupport: {
    reviewedMultiComponentSupport: [
      bullet("supported for reviewed service plus sidecar or shared-platform slices"),
      bullet("every component must be `service` or `third-party-service`"),
    ],
    additionalUnsupportedShapes: ["`static-webapp`", "`ssr-webapp`", "`mobile-app`"],
  },
  rolloutPolicyOmissionInPolicy: {
    singleComponent: true,
    multiComponent: false,
    reviewedPosture: [
      bullet("omission is reviewed only for the single-component service slice"),
      bullet("protected/shared multi-component deployments must declare rollout policy explicitly"),
    ],
  },
  rolloutSupport: {
    reviewedMultiComponentPosture: [
      bullet("`ordered_best_effort`"),
      bullet("`abort = stop_on_first_failure`"),
      bullet("`smoke = final_only`"),
      bullet("`steps` must list every component id exactly once"),
    ],
  },
  previewSupport: {
    support: [bullet("not reviewed in the initial `kubernetes` slice")],
  },
  smokeReleaseHealth: {
    defaultSmokeModel: [
      bullet("built-in service-health smoke against the reviewed release endpoint after publish"),
      bullet(
        "the initial slice assumes namespace and release identity come from authoritative deployment metadata rather than from Helm values drift",
      ),
    ],
  },
  builtInPublisherContract: {
    publisherTypes: ["helm-release"],
    exactPublishInput: [bullet("one or more admitted immutable service-style component artifacts")],
    checkedInProviderConfig: [
      bullet(
        "`helm/values.yaml` or equivalent release values remain provider-local publish configuration only",
      ),
      bullet(
        "deployment metadata remains authoritative for cluster, namespace, and release identity; config drift must fail closed before publish",
      ),
      bullet(
        "the reviewed initial slice requires a provider-local `chart` entry and may declare `smoke_url` plus optional `smoke_expect_contains` for service-health validation",
      ),
      bullet(
        "the rendered publish config injects the admitted per-component artifact paths and identities so the release step consumes exact resolved inputs instead of ambient workspace state",
      ),
    ],
  },
  retryIdempotency: [
    bullet(
      "exact-artifact retry must reuse the same reviewed provider-target identity and release values fingerprint",
    ),
    bullet(
      "ambiguous provider outcomes must fail closed rather than silently replaying Helm mutation",
    ),
    bullet("the initial slice does not define preview, rollback, or promotion workflows"),
  ],
  partialPublishObservability: [
    bullet("the adapter should preserve:", [
      bullet("canonical provider-target identity"),
      bullet("namespace and release identity"),
      bullet("exact component artifact identities"),
      bullet("per-component publish state for shared-platform or sidecar-shaped deployments"),
    ]),
  ],
  provisionerSupport: [
    bullet("reviewed built-in provisioners for the initial slice:", [
      bullet("`terraform-stack`"),
      bullet("`cdktf-stack`"),
    ]),
    bullet("meaning:", [
      bullet(
        "the normal deploy path may prepare namespace, ingress, storage, service-account, or related cluster wiring before publish",
      ),
      bullet(
        "deployment metadata stays authoritative for target identity while the provisioner config stays provider-local",
      ),
      bullet(
        "the initial reviewed deploy flow records a provisioner plan artifact alongside publish records when a built-in Kubernetes provisioner is declared",
      ),
    ]),
  ],
  releaseActions: {
    supportsProtectedShared: false,
    declaredTypes: [],
    routineAllowedTypes: [],
    reviewedSupport: [
      bullet("not supported in the reviewed initial `kubernetes` capability entry"),
    ],
  },
  protectedSharedEligibility: [
    bullet("in policy for protected/shared single-component service deployments"),
    bullet(
      "in policy for protected/shared reviewed multi-component service plus sidecar or shared-platform deployments only when the deployment declares the reviewed explicit rollout policy",
    ),
    bullet(
      "protected/shared execution must stay inside vetted built-in publisher, provisioner, and service-health smoke code",
    ),
  ],
};
