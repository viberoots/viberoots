#!/usr/bin/env zx-wrapper
import {
  SSR_WEBAPP_COMPONENT_KIND,
  STATIC_WEBAPP_COMPONENT_KIND,
} from "../deployment-component-kinds.ts";
import { NIXOS_SHARED_HOST_PROVIDER } from "../deployment-provider-targets.ts";
import {
  NIXOS_SHARED_HOST_BUILT_IN_PUBLISHER_FACTS,
  NIXOS_SHARED_HOST_IMMUTABLE_REUSE_OPERATOR_FLOWS,
  NIXOS_SHARED_HOST_PARTIAL_PUBLISH_OBSERVABILITY,
  NIXOS_SHARED_HOST_PROVISIONER_SUPPORT,
  NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_BASELINE,
  NIXOS_SHARED_HOST_RETRY_IDEMPOTENCY,
} from "./nixos-shared-host-details.ts";
import type { DeploymentProviderCapability } from "./types.ts";
import { bullet } from "./types.ts";

export const NIXOS_SHARED_HOST_PROVIDER_CAPABILITY: DeploymentProviderCapability = {
  provider: NIXOS_SHARED_HOST_PROVIDER,
  supportedComponentKinds: [STATIC_WEBAPP_COMPONENT_KIND, SSR_WEBAPP_COMPONENT_KIND],
  multiComponentKinds: [STATIC_WEBAPP_COMPONENT_KIND],
  supportedRolloutModes: ["all_at_once", "ordered_best_effort"],
  defaultRolloutMode: "all_at_once",
  canonicalTargetIdentity: {
    fields: ["`host`", "`target_group`", "`app_name`"],
    lockKeyShape: [bullet("`nixos-shared-host:<target_group>:<app_name>`")],
    requiredNormalizedDerivedFields: [
      bullet('`hostname = "${appName}.apps.kilty.io"`'),
      bullet('`container_name = "${appName}"`'),
    ],
  },
  componentSupport: {
    reviewedMultiComponentSupport: [
      bullet("reviewed for `shared_nonprod` only when every component is a `static-webapp`"),
      bullet("all components must resolve to one `target_group`"),
      bullet("every component must declare a distinct `app_name`"),
      bullet(
        "replay-style flows (`publish-only`, retry, rollback, promotion) are reviewed for the ordered-best-effort static-webapp slice when the replay source preserves per-component exact artifact and publish state",
      ),
      bullet("the reviewed `ssr-webapp` slice is single-component only"),
    ],
    additionalUnsupportedShapes: [
      "explicit subdomain-style overrides",
      "provider-family use with non-webapp component targets",
    ],
  },
  rolloutPolicyOmissionInPolicy: {
    singleComponent: true,
    multiComponent: false,
    reviewedPosture: [
      bullet("omission is reviewed only for single-component deployments"),
      bullet(
        "protected/shared multi-component deployments must declare `rollout_policy` explicitly even when the intended behavior would otherwise match the provider default",
      ),
    ],
  },
  rolloutSupport: {
    reviewedMultiComponentPosture: [
      bullet("`ordered_best_effort` for the reviewed multi-component static-webapp slice, with:", [
        bullet("explicit `rollout_policy`"),
        bullet('`abort = "stop_on_first_failure"`'),
        bullet('`smoke = "final_only"`'),
        bullet("`steps` listing every component id exactly once"),
      ]),
    ],
  },
  previewSupport: {
    support: [bullet("not reviewed in the initial `nixos-shared-host` slice")],
  },
  smokeReleaseHealth: {
    defaultSmokeModel: [
      bullet(
        "when `healthPath` is declared, smoke resolves against `https://${appName}.apps.kilty.io${healthPath}`",
      ),
      bullet(
        "every static-webapp publish also validates `https://${appName}.apps.kilty.io/` and rejects success when the public root does not serve the just-published `index.html`",
      ),
      bullet(
        "every reviewed `ssr-webapp` publish validates `https://${appName}.apps.kilty.io/` and optional `healthPath` against the admitted SSR runtime instead of inferring a static artifact contract",
      ),
    ],
  },
  builtInPublisherContract: {
    publisherTypes: ["nixos-shared-host-static-webapp", "nixos-shared-host-ssr-webapp"],
    additionalFacts: NIXOS_SHARED_HOST_BUILT_IN_PUBLISHER_FACTS,
  },
  retryIdempotency: NIXOS_SHARED_HOST_RETRY_IDEMPOTENCY,
  replaySnapshotBaseline: NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_BASELINE,
  immutableReuseOperatorFlows: NIXOS_SHARED_HOST_IMMUTABLE_REUSE_OPERATOR_FLOWS,
  partialPublishObservability: NIXOS_SHARED_HOST_PARTIAL_PUBLISH_OBSERVABILITY,
  provisionerSupport: NIXOS_SHARED_HOST_PROVISIONER_SUPPORT,
  releaseActions: {
    supportsProtectedShared: true,
    declaredTypes: ["cache_warmup", "post_publish_verification", "schema_migration"],
    routineAllowedTypes: ["cache_warmup", "post_publish_verification"],
    reviewedSupport: [
      bullet("supported only for the reviewed built-in types:", [
        bullet("`cache_warmup`"),
        bullet("`post_publish_verification`"),
      ]),
      bullet(
        "reviewed built-in action types that must be rejected on the ordinary protected/shared deploy path:",
        [bullet("`schema_migration`")],
      ),
      bullet(
        "replay follows the recorded per-action replay policy for `retry`, `rollback`, and `promotion`",
      ),
      bullet("package-local executable hooks remain out of policy"),
    ],
  },
  protectedSharedEligibility: [
    bullet("`protection_class` defaults to `shared_nonprod`"),
    bullet(
      "protected/shared remote artifact submissions require service-issued authorized one-time challenges, reviewed proof-key binding, expected/admitted artifact identity binding, and server-side proof verification before worker queueing",
    ),
    bullet(
      "the initial reviewed slice supports shared-dev metadata extraction, authoritative platform-state reconciliation, and deterministic host realization for static webapps plus the single-component reviewed SSR runtime slice on a NixOS host",
    ),
    bullet(
      "protected/shared execution must stay inside the vetted built-in publisher, provisioner, smoke-runner, and reviewed built-in `release_actions` registry; package-local executable hooks are rejected on the normal control-plane path",
    ),
  ],
};
