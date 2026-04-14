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
    bullet("exact-artifact retry is reviewed only when the prior attempt is clearly safe to rerun"),
    bullet("ambiguous provider outcomes must fail closed rather than silently retrying"),
    bullet("the initial slice does not define promotion, preview, or rollback workflows"),
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
      "`--provision-only` is not reviewed in the initial slice; provisioning is coupled to the first built-in deploy workflow",
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
      "protected/shared execution must stay inside vetted built-in publisher, provisioner, and smoke-runner code",
    ),
  ],
};
