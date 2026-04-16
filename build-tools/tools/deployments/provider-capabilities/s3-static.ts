#!/usr/bin/env zx-wrapper
import { STATIC_WEBAPP_COMPONENT_KIND } from "../deployment-component-kinds.ts";
import { S3_STATIC_PROVIDER } from "../deployment-provider-targets.ts";
import type { DeploymentProviderCapability } from "./types.ts";
import { bullet } from "./types.ts";

export const S3_STATIC_PROVIDER_CAPABILITY: DeploymentProviderCapability = {
  provider: S3_STATIC_PROVIDER,
  supportedComponentKinds: [STATIC_WEBAPP_COMPONENT_KIND],
  multiComponentKinds: [],
  supportedRolloutModes: ["all_at_once"],
  defaultRolloutMode: "all_at_once",
  canonicalTargetIdentity: {
    fields: ["`account`", "`bucket`", "optional `distribution`"],
    lockKeyShape: [
      bullet("`s3-static:<account>/<bucket>`"),
      bullet(
        "when a reviewed CDN hostname is part of the live target contract, the normalized identity appends `#distribution:<distribution>`",
      ),
    ],
  },
  componentSupport: {
    reviewedMultiComponentSupport: [bullet("not supported in the reviewed initial slice")],
    additionalUnsupportedShapes: ["preview/ephemeral targets", "non-static component kinds"],
  },
  rolloutPolicyOmissionInPolicy: {
    singleComponent: true,
    multiComponent: false,
    reviewedPosture: [
      bullet("omission is reviewed only for the single-component static-webapp slice"),
    ],
  },
  rolloutSupport: {},
  previewSupport: {
    support: [bullet("not reviewed in the initial `s3-static` slice")],
  },
  smokeReleaseHealth: {
    defaultSmokeModel: [
      bullet("built-in HTTP smoke against the reviewed canonical URL after publish"),
      bullet("when `distribution` is declared, the canonical URL is `https://${distribution}/`"),
      bullet(
        "otherwise the canonical URL is the bucket website endpoint `https://${bucket}.s3-website.${region}.amazonaws.com/`",
      ),
    ],
  },
  builtInPublisherContract: {
    publisherTypes: ["aws-s3-sync"],
    exactPublishInput: [bullet("one admitted immutable `static-webapp` artifact directory")],
    checkedInProviderConfig: [
      bullet("`aws-s3-sync.jsonc` remains provider-local publish configuration only"),
      bullet(
        "deployment metadata remains authoritative for `bucket`, `region`, and optional `distribution`; config drift must fail closed before publish",
      ),
    ],
  },
  retryIdempotency: [
    bullet(
      "shared `--publish-only` reuses only an admitted exact artifact selected with `--source-run-id`",
    ),
    bullet("same-deployment `--publish-only` is reviewed as `retry`"),
    bullet(
      "same-deployment rollback is reviewed only for prior successful normal runs on the same canonical live target identity",
    ),
    bullet(
      "ambiguous provider outcomes must fail closed rather than silently retrying or rebuilding",
    ),
  ],
  immutableReuseOperatorFlows: [
    bullet("reviewed protected/shared exact-artifact reuse slice:", [
      bullet(
        "`deploy --deployment <label> --publish-only --source-run-id <deploy-run-id>` reuses the admitted exact artifact plus the recorded deployment snapshot",
      ),
      bullet("same-deployment rollback requires both `--publish-only` and `--rollback`"),
      bullet(
        "rollback source selection is limited to prior successful normal live-target runs for the same deployment",
      ),
      bullet("retry or rollback fails closed when the retained exact artifact is unavailable"),
    ]),
  ],
  partialPublishObservability: [
    bullet("the adapter records:", [
      bullet("canonical provider-target identity"),
      bullet("exact artifact identity"),
      bullet("provider config fingerprint"),
      bullet("provider release id when the publisher exposes one"),
    ]),
  ],
  provisionerSupport: [
    bullet("reviewed built-in provisioners for the initial slice:", [
      bullet("`terraform-stack`"),
      bullet("`cdktf-stack`"),
    ]),
    bullet("meaning:", [
      bullet(
        "the normal deploy path may materialize one reviewed non-destructive plan artifact for bucket/CDN/DNS ownership before publish",
      ),
      bullet(
        "the plan artifact fingerprint is available for protected/shared admission binding and operator review",
      ),
    ]),
    bullet(
      "`--provision-only` is reviewed for protected/shared deployments through the control-plane service when the deployment declares one reviewed built-in provisioner",
    ),
    bullet(
      "that provision-only path still binds one admitted source revision and one frozen execution snapshot before provider mutation",
    ),
  ],
  releaseActions: {
    supportsProtectedShared: false,
    declaredTypes: [],
    routineAllowedTypes: [],
    reviewedSupport: [bullet("not supported in the reviewed initial `s3-static` capability entry")],
  },
  protectedSharedEligibility: [
    bullet("in policy for protected/shared single-component static-webapp deployments"),
    bullet(
      "protected/shared mutation, exact-artifact retry or rollback reuse, and reviewed `--provision-only` execution must route through the reviewed control-plane service / worker front door",
    ),
    bullet(
      "protected/shared execution must stay inside vetted built-in publisher, provisioner, and smoke-runner code",
    ),
  ],
};
