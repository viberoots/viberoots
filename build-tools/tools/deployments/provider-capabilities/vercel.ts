#!/usr/bin/env zx-wrapper
import { SSR_WEBAPP_COMPONENT_KIND } from "../deployment-component-kinds.ts";
import { VERCEL_PROVIDER } from "../vercel-provider-target.ts";
import type { DeploymentProviderCapability } from "./types.ts";
import { bullet } from "./types.ts";

export const VERCEL_PROVIDER_CAPABILITY: DeploymentProviderCapability = {
  provider: VERCEL_PROVIDER,
  supportedComponentKinds: [SSR_WEBAPP_COMPONENT_KIND],
  multiComponentKinds: [],
  supportedRolloutModes: ["all_at_once"],
  defaultRolloutMode: "all_at_once",
  canonicalTargetIdentity: {
    fields: ["`team`", "`project`", "`environment`"],
    lockKeyShape: [bullet("`vercel:<team>/<project>#<environment>`")],
  },
  componentSupport: {
    reviewedMultiComponentSupport: [bullet("not supported in the initial Vercel slice")],
    additionalUnsupportedShapes: ["static webapps", "provider-side Git auto-builds"],
  },
  rolloutPolicyOmissionInPolicy: {
    singleComponent: true,
    multiComponent: false,
    reviewedPosture: [bullet("omission is reviewed only for one prebuilt `ssr-webapp` artifact")],
  },
  rolloutSupport: {
    unsupportedModes: [
      "all_or_nothing",
      "ordered_best_effort",
      "parallel_best_effort",
      "canary",
      "blue_green",
      "phased",
      "store_staged",
    ],
  },
  previewSupport: {
    support: [
      bullet("preview publish and preview cleanup are audited source-run scoped operations"),
      bullet("preview mutations require the same secret-runtime token contract as publish"),
    ],
  },
  smokeReleaseHealth: {
    defaultSmokeModel: [
      bullet("built-in HTTP smoke is deferred to the live Vercel publisher PR"),
      bullet("the local publisher records the reviewed canonical URL without probing it"),
    ],
  },
  builtInPublisherContract: {
    publisherTypes: ["vercel-prebuilt"],
    exactPublishInput: [bullet("one admitted immutable Vercel Build Output API artifact")],
    checkedInProviderConfig: [
      bullet("publisher config records team, project, environment, and `mode: prebuilt`"),
      bullet("`mode: git-autobuild` and ambient `.vercel` state are rejected"),
    ],
  },
  retryIdempotency: [
    bullet("fake API publishes are deterministic for target identity plus artifact identity"),
    bullet("retry and rollback use recorded exact artifacts and never rebuild from branch state"),
    bullet("ambiguous provider API outcomes fail closed with explicit records"),
    bullet(
      "shared `--publish-only` reuses only an admitted exact prebuilt artifact selected with `--source-run-id`",
    ),
    bullet("same-deployment `--publish-only` is reviewed as `retry`"),
    bullet(
      "same-deployment rollback is reviewed only for prior successful normal runs on the same canonical live target identity",
    ),
  ],
  immutableReuseOperatorFlows: [
    bullet("same-deployment rollback requires both `--publish-only` and `--rollback`"),
    bullet(
      "rollback source selection is limited to prior successful normal live-target runs for the same deployment",
    ),
    bullet("retry or rollback fails closed when the retained exact artifact is unavailable"),
  ],
  partialPublishObservability: [
    bullet("the local fixture records provider release id, public URL, and artifact identity"),
  ],
  provisionerSupport: [
    bullet("not supported in the initial Vercel provider slice"),
    bullet(
      "`--provision-only` is reviewed for protected/shared deployments through the control-plane service when the deployment declares one reviewed built-in provisioner",
    ),
  ],
  releaseActions: {
    supportsProtectedShared: false,
    declaredTypes: [],
    routineAllowedTypes: [],
    reviewedSupport: [bullet("not supported in the initial Vercel provider slice")],
  },
  protectedSharedEligibility: [
    bullet("protected/shared Vercel mutation is routed through the reviewed control-plane service"),
    bullet("laptop-local protected/shared artifact paths are rejected by the public front door"),
    bullet(
      "protected/shared mutation, exact-artifact retry or rollback reuse, and reviewed `--provision-only` execution must route through the reviewed control-plane service / worker front door",
    ),
  ],
};
