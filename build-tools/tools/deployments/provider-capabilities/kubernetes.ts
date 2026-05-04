#!/usr/bin/env zx-wrapper
import {
  SERVICE_COMPONENT_KIND,
  THIRD_PARTY_SERVICE_COMPONENT_KIND,
} from "../deployment-component-kinds";
import { KUBERNETES_PROVIDER } from "../deployment-provider-targets";
import type { DeploymentProviderCapability } from "./types";
import { bullet } from "./types";

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
      "shared `--publish-only` reuses only admitted exact component artifacts selected with `--source-run-id`",
    ),
    bullet("same-deployment `--publish-only` is reviewed as `retry`"),
    bullet(
      "same-deployment rollback is reviewed only for prior successful normal runs on the same canonical release target identity",
    ),
    bullet(
      "ambiguous provider outcomes must fail closed rather than silently replaying Helm mutation or rebuilding",
    ),
  ],
  immutableReuseOperatorFlows: [
    bullet("reviewed protected/shared exact-artifact reuse slice:", [
      bullet(
        "`deploy --deployment <label> --publish-only --source-run-id <deploy-run-id>` reuses the recorded exact component artifacts plus the recorded deployment snapshot",
      ),
      bullet("same-deployment rollback requires both `--publish-only` and `--rollback`"),
      bullet(
        "rollback source selection is limited to prior successful normal release-target runs for the same deployment",
      ),
      bullet(
        "retry and rollback preserve the recorded release values fingerprint and per-component publish inputs instead of re-resolving ambient workspace state",
      ),
    ]),
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
      bullet("`opentofu-stack`"),
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
    bullet(
      "`--provision-only` is reviewed for protected/shared deployments through the control-plane service when the deployment declares one reviewed built-in provisioner",
    ),
    bullet(
      "`opentofu-stack` provisioners must keep stack-owned files under the deployment package `opentofu/` directory and bind stack identity plus state backend identity into admission evidence",
    ),
    bullet(
      "that provision-only path still binds one admitted source revision and one frozen execution snapshot before provider mutation",
    ),
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
      "protected/shared mutation, exact-artifact retry or rollback reuse, and reviewed `--provision-only` execution must route through the reviewed control-plane service / worker front door",
    ),
    bullet(
      "protected/shared execution must stay inside vetted built-in publisher, provisioner, and service-health smoke code",
    ),
    bullet(
      "protected/shared kubernetes service publish, retry, rollback, and promotion must declare `secret_requirements` at the `publish` step; ambient Helm or cluster credentials are rejected and the publisher process receives only the resolved reviewed credential env",
    ),
  ],
};
