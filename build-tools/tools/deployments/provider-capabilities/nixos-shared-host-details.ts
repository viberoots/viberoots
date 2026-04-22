#!/usr/bin/env zx-wrapper
import type { ProviderCapabilityBullet } from "./types.ts";
import { bullet } from "./types.ts";

export const NIXOS_SHARED_HOST_BUILT_IN_PUBLISHER_FACTS: ProviderCapabilityBullet[] = [
  bullet("reviewed SSR runtime contract for `nixos-shared-host-ssr-webapp`:", [
    bullet("admitted immutable artifact kind is `ssr-webapp`"),
    bullet("the artifact must contain `dist/server/index.js`"),
    bullet("the artifact must contain `dist/client`"),
    bullet("the host runtime starts the server with `node dist/server/index.js`"),
    bullet(
      "`runtime_config_requirements` and `secret_requirements` remain the only reviewed runtime-config and secret injection boundary for this slice",
    ),
    bullet(
      "promotion-safe lanes require the reviewed contract `node-dist-server-v1` and serving topology `single-host-node-with-nginx`",
    ),
  ]),
];

export const NIXOS_SHARED_HOST_RETRY_IDEMPOTENCY: ProviderCapabilityBullet[] = [
  bullet("reviewed initial publish contract for `nixos-shared-host-static-webapp`:", [
    bullet(
      "stage immutable artifact contents under `/srv/static-app/releases/<artifact-identity>`",
    ),
    bullet("activate by atomically repointing `/srv/static-app/current`"),
    bullet("keep nginx rooted at `/srv/static-app/live`, which remains a stable link to `current`"),
    bullet(
      "re-publishing an already-staged artifact identity may reuse the existing release directory",
    ),
    bullet(
      "admitted deploys persist the exact static artifact under the local artifact/provenance store before publish starts",
    ),
    bullet(
      "the shared control-plane execution snapshot freezes publish input as an exact-artifact reference instead of a workstation-local `artifactDir`",
    ),
    bullet(
      "multi-component replay may skip a previously published component only when the host can prove the live immutable artifact identity already matches the recorded exact artifact identity; otherwise it must republish conservatively",
    ),
  ]),
  bullet("reviewed initial publish contract for `nixos-shared-host-ssr-webapp`:", [
    bullet("stage immutable artifact contents under `/srv/ssr-app/releases/<artifact-identity>`"),
    bullet("activate by atomically repointing `/srv/ssr-app/current`"),
    bullet(
      "keep `/srv/ssr-app/live` stable for the reviewed Node runtime and nginx ingress contract",
    ),
    bullet("preserve exact SSR runtime-contract provenance in records and replay snapshots"),
  ]),
];

export const NIXOS_SHARED_HOST_REPLAY_SNAPSHOT_BASELINE: ProviderCapabilityBullet[] = [
  bullet("reviewed immutable-reuse baseline for `nixos-shared-host-static-webapp`:", [
    bullet("each admitted deploy persists a replay snapshot for the run"),
    bullet("the replay snapshot records:", [
      bullet("the exact publish input:", [
        bullet("one exact artifact reference for single-component runs"),
        bullet(
          "per-component exact artifact references plus one composite artifact identity for multi-component runs",
        ),
      ]),
      bullet("canonical provider-target identity"),
      bullet("deployment metadata fingerprint"),
      bullet("platform-state snapshot reference"),
      bullet("rendered host-config snapshot reference"),
      bullet(
        "per-component artifact, publish, smoke, and live-identity state once the run reaches publish",
      ),
    ]),
    bullet(
      "reusable artifact provenance stays in the artifact/provenance store, while deployment-run records point at that artifact plus the replay snapshot used for the run",
    ),
  ]),
];

export const NIXOS_SHARED_HOST_IMMUTABLE_REUSE_OPERATOR_FLOWS: ProviderCapabilityBullet[] = [
  bullet(
    "reviewed immutable-reuse slice for `shared_nonprod` `nixos-shared-host` static-webapp deployments:",
    [
      bullet("shared `--publish-only` must name an admitted source run with `--source-run-id`"),
      bullet(
        "shared `--publish-only` must not accept a fresh local `artifactDir` as an implicit rebuild input",
      ),
      bullet("same-deployment `--publish-only` is recorded as `retry`"),
      bullet("same-deployment rollback requires both `--publish-only` and `--rollback`"),
      bullet(
        "rollback source selection is limited to prior successful normal runs for the same deployment",
      ),
      bullet(
        "successful `retry`, `rollback`, and `explicit_removal` runs are not valid rollback sources",
      ),
      bullet(
        "if the retained exact artifact is unavailable, retry or rollback fails closed instead of rebuilding",
      ),
      bullet(
        "multi-component retry, rollback, and same-artifact promotion reuse recorded per-component exact artifact inputs rather than re-resolving local build state",
      ),
      bullet(
        "multi-component retry remains deployment-atomic by default after a partial publish failure; already-live components may be treated as no-op reuse only with exact live-identity proof",
      ),
    ],
  ),
];

export const NIXOS_SHARED_HOST_PARTIAL_PUBLISH_OBSERVABILITY: ProviderCapabilityBullet[] = [
  bullet("the initial local record surface preserves:", [
    bullet("canonical `operation_kind = deploy`"),
    bullet("`run_classification = deploy | retry | rollback | explicit_removal`"),
    bullet("`publish_mode = normal`"),
    bullet("`lifecycle_state = finished`"),
    bullet("canonical `final_outcome`"),
    bullet("deployment id and deployment label"),
    bullet(
      "canonical provider-target identity as both structured provider-target fields and normalized identity",
    ),
    bullet("artifact identity for publish runs"),
    bullet("artifact provenance and stored exact-artifact references for admitted deploys"),
    bullet("parent-run and artifact-lineage fields for retry / rollback reuse"),
    bullet("deployment metadata fingerprint and replay snapshot path"),
    bullet("failed step when a run terminates unsuccessfully after service-side admission"),
    bullet("for multi-component runs:", [
      bullet("per-component exact artifact references"),
      bullet("per-component publish outcome, smoke outcome, and live-identity proof"),
      bullet("per-component no-op reuse evidence when replay safely skips a publish"),
    ]),
  ]),
];

export const NIXOS_SHARED_HOST_PROVISIONER_SUPPORT: ProviderCapabilityBullet[] = [
  bullet("reviewed built-in provisioner reference for the initial slice:", [
    bullet("`nixos-shared-host-manifest`"),
  ]),
  bullet("meaning:", [
    bullet(
      "shared control-plane `deploy` and `explicit_removal` runs generate one reviewed provisioner plan artifact from the frozen execution snapshot before the first mutating provider step",
    ),
    bullet(
      "the plan artifact fingerprint is bound into protected/shared admission evidence so approval and later revalidation fail closed on plan drift",
    ),
    bullet(
      "routine `deploy` remains non-destructive by default; if the reviewed plan would delete or replace an owned live target identity, the routine path is rejected and operators must use the separate destructive workflow instead of piggybacking on ordinary deploy authority",
    ),
    bullet(
      "reviewed deploy/control-plane workflows maintain one authoritative cumulative platform-state artifact for the selected `nixos-shared-host` target",
    ),
    bullet(
      "scoped apply may create or update only the named deployment entries in that platform state",
    ),
    bullet("authoritative full reconcile may replace the full platform state"),
    bullet(
      "explicit removal deletes one named deployment entry without inferring deletion from slice-local omission",
    ),
    bullet(
      "host realization consumes only that authoritative platform state and owns container and ingress creation on the target NixOS host",
    ),
    bullet(
      "host generation derives one generic `static-app-host` container plus one nginx route per declared app and fails closed on duplicate hostnames or backend identities",
    ),
    bullet(
      "the current host-consumer boundary is the NixOS module `build-tools/tools/nix/nixos-shared-host-module.nix`",
    ),
    bullet(
      "the initial operator workflow also has a reviewed service materialization path that mirrors the same container filesystem contract for end-to-end publish and smoke testing",
    ),
  ]),
];
