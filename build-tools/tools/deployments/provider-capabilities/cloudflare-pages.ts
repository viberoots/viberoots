#!/usr/bin/env zx-wrapper
import { STATIC_WEBAPP_COMPONENT_KIND } from "../deployment-component-kinds.ts";
import { CLOUDFLARE_PAGES_PROVIDER } from "../deployment-provider-targets.ts";
import type { DeploymentProviderCapability } from "./types.ts";
import { bullet } from "./types.ts";

export const CLOUDFLARE_PAGES_PROVIDER_CAPABILITY: DeploymentProviderCapability = {
  provider: CLOUDFLARE_PAGES_PROVIDER,
  supportedComponentKinds: [STATIC_WEBAPP_COMPONENT_KIND],
  multiComponentKinds: [],
  supportedRolloutModes: ["all_at_once"],
  defaultRolloutMode: "all_at_once",
  canonicalTargetIdentity: {
    fields: ["`project`", "`account`"],
    lockKeyShape: [bullet("`cloudflare-pages:<account>/<project>`")],
  },
  componentSupport: {
    reviewedMultiComponentSupport: [
      bullet("not supported for protected/shared use"),
      bullet("deployments must contain exactly one `static-webapp` component"),
    ],
    additionalUnsupportedShapes: [
      "complex multi-component systems",
      "provider-specific arbitrary executable hooks in protected/shared paths",
    ],
  },
  rolloutPolicyOmissionInPolicy: {
    singleComponent: true,
    multiComponent: false,
    reviewedPosture: [
      bullet("omission is reviewed only for the single-component static-webapp slice"),
      bullet("no multi-component or advanced-rollout omission path is in policy"),
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
    support: [
      bullet("supported only when the deployment explicitly opts in with `preview` metadata"),
      bullet(
        "the current built-in operator contract uses `deploy <deployment> --preview --source-run-id <deploy-run-id>`",
      ),
    ],
    isolationModel: [
      bullet(
        "provider-managed isolated preview target derived deterministically from deployment metadata plus run context",
      ),
    ],
    cleanupDefault: [
      bullet(
        "provider-managed cleanup with a default TTL of `7d`; deployment metadata may override when needed",
      ),
      bullet(
        "the current built-in explicit cleanup contract uses `deploy <deployment> --preview-cleanup --source-run-id <deploy-run-id>`",
      ),
    ],
    lockScopeDefault: [
      bullet("preview shares the normal deployment lock by default"),
      bullet(
        "a separate preview lock scope is allowed only when the preview satisfies the stronger independent-execution isolation bar",
      ),
    ],
    requiredGuarantees: [
      "isolated effective mutable target identity",
      "isolated smoke target",
      "isolated cleanup path",
    ],
  },
  smokeReleaseHealth: {
    defaultSmokeModel: [
      bullet("built-in HTTP smoke against the configured canonical URL"),
      bullet(
        "for the reviewed static-webapp slice, the canonical normal URL is `https://${project}.pages.dev/`",
      ),
      bullet(
        "the initial built-in smoke run validates that canonical root URL after publish and blocks success on mismatch or non-200",
      ),
    ],
    previewOverride: [bullet("may use preview URL only when explicitly configured")],
  },
  builtInPublisherContract: {
    publisherTypes: ["wrangler-pages"],
    exactPublishInput: [bullet("one admitted immutable `static-webapp` artifact directory")],
    checkedInProviderConfig: [
      bullet("`wrangler.jsonc` remains provider-native Wrangler configuration only"),
      bullet(
        "deployment metadata injects or validates the authoritative Pages project name instead of allowing config drift to silently retarget publish",
      ),
    ],
    accountSelection: [
      bullet(
        "protected/shared execution must derive the Cloudflare account scope from authoritative deployment metadata rather than ambient local CLI defaults",
      ),
    ],
  },
  retryIdempotency: [
    bullet("publish retry may be allowed only for clearly transient network/provider failures"),
    bullet(
      "if the provider cannot prove idempotent retry semantics after an ambiguous result, the adapter must reconcile remote state before retrying",
    ),
    bullet(
      "same-deployment rollback is supported only as exact-artifact reuse through `deploy <deployment> --publish-only --rollback --source-run-id <deploy-run-id>`",
    ),
    bullet(
      "rollback source selection is limited to prior successful normal live-target runs for the same deployment",
    ),
    bullet(
      "rollback fails closed when the retained exact artifact is unavailable or when the selected source run refers to preview rather than the normal live target",
    ),
  ],
  targetTransitionSupport: [
    bullet("reviewed retire/migrate-target support:", [
      bullet(
        "supported only through the separate operator workflows `deploy <deployment> --retire-target --target-exception-ref <label>` and `deploy <deployment> --migrate-target --target-exception-ref <label>`",
      ),
    ]),
    bullet("reviewed exception requirements:", [
      bullet(
        "the selected target exception must be active, must carry the reviewed shared lock scope, and must not be superseded",
      ),
      bullet("migration exceptions must define `new_provider_target_identity`"),
    ]),
    bullet("audit guarantees:", [
      bullet(
        "records preserve old target identity, new target identity when applicable, the selected exception object, and the resulting ownership state",
      ),
    ]),
  ],
  partialPublishObservability: [
    bullet("the adapter should preserve:", [
      bullet("provider-exposed deployment id or equivalent publish id"),
      bullet("final publish result"),
    ]),
    bullet(
      "stronger partial-state guarantees are implementation-dependent and should not be assumed without explicit adapter support",
    ),
  ],
  provisionerSupport: [
    bullet("deployment-owned provisioners for protected/shared mutation:"),
    bullet("not supported in the reviewed `cloudflare-pages` capability entry"),
    bullet("implication:", [
      bullet(
        "protected/shared `cloudflare-pages` deployments should reject provisioner-managed infra mutation until a reviewed capability update defines allowed built-in provisioner types and their plan/diff contract",
      ),
    ]),
  ],
  releaseActions: {
    supportsProtectedShared: false,
    declaredTypes: [],
    routineAllowedTypes: [],
    reviewedSupport: [
      bullet("not supported in the reviewed `cloudflare-pages` capability entry"),
      bullet("allowed built-in action types: none"),
      bullet(
        "rejected built-in action types: all until a reviewed capability update explicitly allows specific types and their replay expectations",
      ),
      bullet("implication:", [
        bullet(
          "protected/shared `cloudflare-pages` deployments should reject `release_actions` until a reviewed capability update explicitly allows specific built-in action types and their replay expectations",
        ),
      ]),
    ],
  },
  protectedSharedEligibility: [
    bullet("in policy for protected/shared single-component static-webapp deployments"),
    bullet(
      "protected/shared execution must stay inside vetted built-in publisher, preview, and smoke-runner code",
    ),
    bullet(
      "package-local executable hooks, deployment-owned provisioners, and unreviewed `release_actions` remain out of policy for the normal shared-control-plane path",
    ),
  ],
  additionalSections: [
    {
      title: "Initial Pleomino Topology",
      bullets: [
        bullet("`pleomino-dev` stays on `nixos-shared-host` as the shared-dev path"),
        bullet("`pleomino-staging` uses `cloudflare-pages` with protection class `shared_nonprod`"),
        bullet("`pleomino-prod` uses `cloudflare-pages` with protection class `production_facing`"),
      ],
    },
  ],
};
