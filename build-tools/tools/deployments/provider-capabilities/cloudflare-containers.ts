#!/usr/bin/env zx-wrapper
import {
  SERVICE_COMPONENT_KIND,
  SSR_WEBAPP_COMPONENT_KIND,
  THIRD_PARTY_SERVICE_COMPONENT_KIND,
} from "../deployment-component-kinds";
import { CLOUDFLARE_CONTAINERS_PROVIDER } from "../cloudflare-containers-provider-target";
import type { DeploymentProviderCapability } from "./types";
import { bullet } from "./types";

export const CLOUDFLARE_CONTAINERS_PROVIDER_CAPABILITY: DeploymentProviderCapability = {
  provider: CLOUDFLARE_CONTAINERS_PROVIDER,
  supportedComponentKinds: [
    SSR_WEBAPP_COMPONENT_KIND,
    SERVICE_COMPONENT_KIND,
    THIRD_PARTY_SERVICE_COMPONENT_KIND,
  ],
  multiComponentKinds: [],
  supportedRolloutModes: ["all_at_once"],
  defaultRolloutMode: "all_at_once",
  canonicalTargetIdentity: {
    fields: ["`account_id`", "`worker`"],
    lockKeyShape: [bullet("`cloudflare-containers:<account_id>/<worker>`")],
  },
  componentSupport: {
    reviewedMultiComponentSupport: [
      bullet("not supported for protected/shared use"),
      bullet("deployments must contain exactly one containerized component"),
    ],
    additionalUnsupportedShapes: [
      "ambient local Docker builds in protected/shared mutation",
      "provider-side Git auto-builds as the authoritative artifact source",
    ],
  },
  rolloutPolicyOmissionInPolicy: {
    singleComponent: true,
    multiComponent: false,
    reviewedPosture: [
      bullet("omission is reviewed only for the single-component local/fake publisher slice"),
      bullet("advanced rollout policy requires a later reviewed live publisher contract"),
    ],
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
    support: [bullet("not reviewed for the initial Containers provider slice")],
    isolationModel: [bullet("no preview target derivation is currently reviewed")],
    cleanupDefault: [bullet("not supported")],
    lockScopeDefault: [bullet("normal deployment lock only")],
    requiredGuarantees: ["separate reviewed PR before preview mutation is allowed"],
  },
  smokeReleaseHealth: {
    defaultSmokeModel: [
      bullet("public ingress may use HTTP smoke against the configured custom domain"),
      bullet("private and no-ingress deployments rely on explicit smoke metadata or exceptions"),
    ],
    previewOverride: [bullet("not supported in the initial reviewed slice")],
  },
  builtInPublisherContract: {
    publisherTypes: ["cloudflare-containers-local"],
    exactPublishInput: [
      bullet("one admitted immutable service artifact directory or OCI image digest file"),
    ],
    checkedInProviderConfig: [
      bullet("`wrangler.jsonc` remains provider-native Worker and Containers configuration"),
      bullet("deployment metadata remains authoritative for account, worker, ingress, and domain"),
    ],
    accountSelection: [
      bullet("protected/shared execution must use declared `cloudflare_account_id` metadata"),
    ],
  },
  retryIdempotency: [
    bullet("local fake publisher retries are deterministic by artifact and config fingerprint"),
    bullet("live retry and rollback require a later reviewed Cloudflare API integration"),
  ],
  targetTransitionSupport: [bullet("not reviewed for the initial Containers provider slice")],
  partialPublishObservability: [
    bullet(
      "records preserve admitted artifact identity, Worker config fingerprint, target identity, and smoke URL when present",
    ),
  ],
  provisionerSupport: [bullet("not supported in the reviewed initial capability entry")],
  releaseActions: {
    supportsProtectedShared: false,
    declaredTypes: [],
    routineAllowedTypes: [],
    reviewedSupport: [
      bullet("not supported in the reviewed `cloudflare-containers` capability entry"),
      bullet("allowed built-in action types: none"),
    ],
  },
  protectedSharedEligibility: [
    bullet("metadata extraction and validation are reviewed"),
    bullet("protected/shared live mutation fails closed until a reviewed live publisher exists"),
  ],
};
