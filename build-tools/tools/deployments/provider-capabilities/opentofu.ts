#!/usr/bin/env zx-wrapper
import { PROVISION_ONLY_COMPONENT_KIND } from "../deployment-component-kinds";
import { OPENTOFU_PROVIDER } from "../deployment-provider-targets";
import type { DeploymentProviderCapability } from "./types";
import { bullet } from "./types";

export const OPENTOFU_PROVIDER_CAPABILITY: DeploymentProviderCapability = {
  provider: OPENTOFU_PROVIDER,
  supportedComponentKinds: [PROVISION_ONLY_COMPONENT_KIND],
  multiComponentKinds: [],
  supportedRolloutModes: ["all_at_once"],
  defaultRolloutMode: "all_at_once",
  canonicalTargetIdentity: {
    fields: ["`stack_identity`", "`state_backend_identity`"],
    lockKeyShape: [bullet("`opentofu:<stack_identity>#state:<state_backend_identity>`")],
    requiredReviewedProviderTargetFields: [
      bullet("`stack_identity` identifies the reviewed foundation or migration stack"),
      bullet("`state_backend_identity` identifies the reviewed state backend boundary"),
    ],
  },
  componentSupport: {
    reviewedMultiComponentSupport: [bullet("not supported for provision-only OpenTofu stacks")],
    additionalUnsupportedShapes: ["publishable application components", "multi-component stacks"],
  },
  rolloutPolicyOmissionInPolicy: {
    singleComponent: true,
    multiComponent: false,
    reviewedPosture: [
      bullet("omission is reviewed only for a single provision-only migration bundle"),
    ],
  },
  rolloutSupport: {},
  previewSupport: {
    support: [bullet("not reviewed for provision-only OpenTofu deployments")],
  },
  smokeReleaseHealth: {
    defaultSmokeModel: [
      bullet("post-apply checks come from reviewed migration evidence rather than HTTP smoke"),
    ],
  },
  builtInPublisherContract: {
    publisherTypes: ["provision-only"],
    exactPublishInput: [bullet("one admitted migration bundle bound to one reviewed stack")],
    checkedInProviderConfig: [
      bullet(
        "`opentofu/` stack files remain provider-local configuration for the deployment package",
      ),
      bullet(
        "the reviewed stack config declares separate reviewed plan JSON and saved apply plan artifacts",
      ),
    ],
  },
  retryIdempotency: [
    bullet("provision-only replay is not supported unless a future capability entry defines it"),
    bullet("ambiguous OpenTofu outcomes must fail closed before repeating provider mutation"),
  ],
  partialPublishObservability: [
    bullet("the foundation record preserves:", [
      bullet("canonical provider-target identity"),
      bullet("stack identity"),
      bullet("state backend identity"),
      bullet("reviewed plan and apply evidence fingerprints"),
      bullet("post-apply check outcomes"),
    ]),
  ],
  provisionerSupport: [
    bullet("the provider itself is the reviewed `opentofu-stack` provision-only path"),
    bullet(
      "OpenTofu files must stay under the deployment package `opentofu/` directory and bind stack identity plus state backend identity into admission evidence",
    ),
  ],
  releaseActions: {
    supportsProtectedShared: false,
    declaredTypes: [],
    routineAllowedTypes: [],
    reviewedSupport: [bullet("release actions are not supported for OpenTofu provision-only runs")],
  },
  protectedSharedEligibility: [
    bullet("in policy for reviewed provision-only migration bundles"),
    bullet("protected/shared mutation must route through the reviewed control-plane front door"),
    bullet(
      "ambient provider credentials are rejected; only resolved reviewed credential env is used",
    ),
  ],
};
