#!/usr/bin/env zx-wrapper
import { MOBILE_APP_COMPONENT_KIND } from "../deployment-component-kinds";
import { APP_STORE_CONNECT_PROVIDER } from "../deployment-provider-targets";
import type { DeploymentProviderCapability } from "./types";
import { bullet } from "./types";

export const APP_STORE_CONNECT_PROVIDER_CAPABILITY: DeploymentProviderCapability = {
  provider: APP_STORE_CONNECT_PROVIDER,
  supportedComponentKinds: [MOBILE_APP_COMPONENT_KIND],
  multiComponentKinds: [],
  supportedRolloutModes: ["all_at_once", "store_staged"],
  defaultRolloutMode: "all_at_once",
  canonicalTargetIdentity: {
    fields: ["`issuer`", "`app`", "`track`"],
    lockKeyShape: [bullet("`app-store-connect:<issuer>/<app>#track:<track>`")],
    requiredReviewedProviderTargetFields: [
      bullet("`bundle_id`"),
      bullet("`platform = ios`"),
      bullet("`signing_model = app-store`"),
    ],
  },
  componentSupport: {
    reviewedMultiComponentSupport: [
      bullet("not supported in the reviewed initial slice"),
      bullet("deployments must contain exactly one `mobile-app` component"),
    ],
    additionalUnsupportedShapes: [
      "Android or mixed-platform releases",
      "non-mobile component kinds",
    ],
  },
  rolloutPolicyOmissionInPolicy: {
    singleComponent: true,
    multiComponent: false,
    reviewedPosture: [
      bullet("omission is reviewed only for the single-component iOS mobile-app slice"),
    ],
  },
  rolloutSupport: {
    reviewedStagedRolloutPosture: [
      bullet('`abort = "stop_on_first_failure"`'),
      bullet('`smoke = "final_only"`'),
      bullet('`steps` may be omitted or set to `["default"]`'),
    ],
  },
  previewSupport: {
    support: [bullet("not reviewed in the initial `app-store-connect` slice")],
  },
  smokeReleaseHealth: {
    defaultSmokeModel: [
      bullet("built-in release-health validation rather than URL smoke"),
      bullet(
        "success requires reviewed upload receipt, processing success, installability, and, when `store_staged` is used, staged-rollout health evidence",
      ),
    ],
  },
  builtInPublisherContract: {
    publisherTypes: ["app-store-connect-mobile-release"],
    exactPublishInput: [bullet("one admitted immutable signed iOS release artifact (`.ipa`)")],
    checkedInProviderConfig: [
      bullet("`app-store-connect.jsonc` remains provider-local publish configuration only"),
      bullet(
        "deployment metadata stays authoritative for issuer, app, bundle id, track, platform, and signing model; config drift must fail closed before publish",
      ),
    ],
  },
  retryIdempotency: [
    bullet(
      "shared `--publish-only` reuses only an admitted exact artifact selected with `--source-run-id`",
    ),
    bullet("same-deployment `--publish-only` is reviewed as `retry`"),
    bullet(
      "same-deployment rollback is reviewed only for prior successful normal runs on the same canonical store target identity",
    ),
    bullet(
      "cross-deployment promotion is reviewed only for exact-artifact reuse through the branch-backed lane contract",
    ),
    bullet(
      "static-webapp exact-artifact promotion may cross reviewed providers only on lane edges that explicitly opt in, and only when the source and target both resolve to the same reviewed static artifact compatibility family",
    ),
  ],
  replaySnapshotBaseline: [
    bullet("each admitted run persists:", [
      bullet("the exact immutable mobile artifact reference"),
      bullet("canonical provider-target identity"),
      bullet("deployment metadata fingerprint"),
      bullet("provider-config snapshot path"),
      bullet(
        "release-health evidence, track state, and rollout state needed for replay eligibility decisions",
      ),
    ]),
  ],
  promotionCompatibility: [
    bullet("promotion-safe mobile lanes treat these as explicit compatibility inputs:", [
      bullet("publisher type must match exactly"),
      bullet("signing model must match exactly"),
      bullet(
        "track progression must move forward through the reviewed App Store Connect track order",
      ),
      bullet(
        "rollout progression may stay at `all_at_once` or advance to `store_staged`, but must not regress",
      ),
    ]),
  ],
  partialPublishObservability: [
    bullet("the adapter records:", [
      bullet("store submission id"),
      bullet("provider release id"),
      bullet("exact artifact identity"),
      bullet("track state"),
      bullet("rollout state"),
      bullet("release-health evidence"),
    ]),
  ],
  provisionerSupport: [
    bullet("deployment-owned provisioners for protected/shared mutation:"),
    bullet("not supported in the reviewed `app-store-connect` capability entry"),
  ],
  releaseActions: {
    supportsProtectedShared: false,
    declaredTypes: [],
    routineAllowedTypes: [],
    reviewedSupport: [bullet("not supported in the reviewed `app-store-connect` capability entry")],
  },
  protectedSharedEligibility: [
    bullet("in policy for protected/shared single-component signed iOS `mobile-app` deployments"),
    bullet(
      "protected/shared execution must stay inside the vetted built-in publisher and release-health validation path",
    ),
  ],
};
