# 25. Rollout Strategy (Blue/Green vs. Canary vs. Simple Replace)

**Tier:** Developer Experience
**Priority:** 25 of 44
**Depends on:** #8 Container Deployment Provider
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Decide which progressive rollout modes to support beyond `all_at_once` for each provider, define the `rollout_policy` declaration requirements, and implement at least one progressive mode for a provider that supports it.

## What

The deployment model already declares a closed rollout-mode vocabulary in `deployment-rollout.ts`
(`DeploymentRolloutMode`: `all_at_once`, `all_or_nothing`, `ordered_best_effort`,
`parallel_best_effort`, `phased`, `canary`, `blue_green`, `store_staged`). The schema field
`rollout_policy` is extractable from `TARGETS` via `readRolloutPolicy` in
`contract-extract-shared.ts`, which reads `rollout_policy.{mode, abort, smoke}` and the parallel
`rollout_steps` list. Field-level validation (`pushRolloutPolicyFieldErrors`) rejects unknown mode,
abort, and smoke values against the closed sets in `deployment-rollout.ts`.

What does not yet exist is the provider-side implementation behind modes other than `all_at_once`
and `ordered_best_effort`. The only provider that has ever exercised progressive rollout machinery
is `nixos-shared-host`, which implements `ordered_best_effort` through
`nixos-shared-host-progressive-rollout.ts` (phase-state machine: pending → running → succeeded /
failed / aborted) and enforces supersedence via
`nixos-shared-host-control-plane-progressive-guard.ts`. Every other currently registered provider
(`cloudflare-pages`, `cloudflare-containers`, `s3-static`, `vercel`, `kubernetes`) lists
`all_at_once` as both the only supported and the default rollout mode. `canary` and `blue_green`
appear in none of those provider capability entries' `supportedRolloutModes`.

This task covers:

1. **Decide the rollout strategy per deployment class.** Map each existing deployment target
   (pleomino-staging, pleomino-prod, any backend service on cloudflare-containers or kubernetes) to
   the rollout mode it should use. For Cloudflare Pages and static deployments, `all_at_once` is
   the correct and complete answer — Cloudflare Pages performs an atomic swap by design and the
   provider capability entry already reflects this. For any containerized service on
   `cloudflare-containers` or `kubernetes`, decide whether `blue_green`, `canary`, `phased`, or
   `all_at_once` is appropriate and record the decision in the affected provider capability entries.

2. **Extend provider capability entries where a non-`all_at_once` mode is selected.** Per the
   design doc, a provider adapter must not support a rollout mode that does not appear in its
   `supportedRolloutModes` list, and adding a new mode requires updating the authoritative registry
   entry in `provider-capabilities/`. If `blue_green` or `canary` is chosen for
   `cloudflare-containers`, the capability entry must be updated to include that mode,
   `rolloutSupport.unsupportedModes` must no longer list it, and the live publisher contract must
   define how the alternate slot, traffic weight, or cutover step is executed.

3. **Implement the advance-gate contract for any progressive mode adopted.** The design doc
   requires every non-trivial rollout to declare `phases`/`steps`, an advance gate per phase,
   abort behavior, and smoke mode. Gate types must come from the reviewed vocabulary:
   `manual_approval`, `smoke_pass`, `metric_threshold`, `time_bake`, `provider_health`,
   `store_health`. A `canary` rollout must additionally declare exposure increments, stabilization
   window, and the explicit completion condition. A `blue_green` rollout must declare how traffic is
   cut over and what happens on abort (keep old slot or cut back per declared cutover policy).

4. **Wire rollout-mode validation into provider front-doors.** Kubernetes already validates in
   `kubernetes-rollout-validation.ts` that multi-component deployments must use
   `ordered_best_effort`. Similar provider-specific validation must be written for any provider
   whose capability entry gains new supported modes, so that an unsupported mode in a `TARGETS`
   file is rejected at admission rather than silently defaulting.

5. **Record progressive-rollout state in deploy records for any new mode.** The design doc requires
   deploy records for progressive rollout to preserve current phase state, whether the rollout is
   resumable, whether a later-phase approval is still required, and the highest completed phase or
   increment. The existing `NixosSharedHostProgressiveRollout` type in
   `nixos-shared-host-progressive-rollout.ts` is a reference implementation of this shape.

## Why Now

This task sits at priority 21 because it depends on having a live containerized provider to deploy
to (#8 Container Deployment Provider). Without a live backend-service provider, the rollout
strategy decision is academic: static-webapp deployments already have the correct mode
(`all_at_once` via Cloudflare Pages atomic swap) and no further implementation is needed for them.

Once #8 lands and there is a live `cloudflare-containers` or `kubernetes` service target, the
question of which rollout strategy to use becomes concrete and operational. Deploying a backend
service with `all_at_once` to a single instance means downtime during the update window. Choosing
`blue_green` avoids that but requires Cloudflare's routing layer or a Kubernetes ingress to support
simultaneous slot existence and explicit cutover. Choosing `canary` requires a metric gate (#41
autoscaling depends on metrics being available) and exposure-increment configuration. The decision
made here directly shapes what #41 (autoscaling) must provide in terms of metrics and what #37
(backup/DR) must provide in terms of rollback-compatible state.

## Risks

- **Provider support gaps.** Both `cloudflare-containers` and `kubernetes` currently declare only
  `all_at_once` as a supported rollout mode. Adding `blue_green` or `canary` requires a reviewed
  capability update and a live publisher implementation that actually performs the multi-step
  operation. If the Cloudflare Containers API does not expose a slot or weight concept, `blue_green`
  or `canary` is not implementable on that provider without external DNS or load-balancer help.

- **Gate evaluation before metric infrastructure exists.** A `canary` or `phased` rollout with a
  `metric_threshold` gate requires an observable metric endpoint that the advance-gate evaluator
  can query. If the metric infrastructure from #41 is not yet present when this task lands, any
  mode requiring `metric_threshold` gates must fall back to `manual_approval` gates as a
  transitional posture and must document that explicitly in the rollout policy.

- **Partial-publish state and rollback.** The design doc is explicit that rollback from a partially
  completed progressive rollout is out of policy by default unless the provider capability entry
  defines how partial state is detected and safely reversed. If `blue_green` is chosen and traffic
  is cut over before rollback candidates are pruned, the rollback path must account for the active
  slot state. This is a correctness hazard if the deploy record does not preserve last-observed
  provider-side slot state.

- **Supersedence during a running progressive rollout.** The existing
  `nixos-shared-host-control-plane-progressive-guard.ts` enforces that a newer run cannot supersede
  an already-running progressive rollout mid-phase. Any new provider implementing progressive
  rollout must apply the same guard. Without it, a concurrent deploy could interleave with a
  mid-canary rollout and produce an undefined traffic state.

## Trade-offs

- **`all_at_once` (simple replace) vs. progressive modes.** For Cloudflare Pages, `all_at_once`
  is the natural and correct choice: Cloudflare's atomic deploy semantics mean there is no partial
  exposure window. For a containerized service with a stateful warm-up period or database migration,
  `all_at_once` trades deployment simplicity for some downtime risk. The correct answer is
  deployment-class-specific and must be recorded in the affected provider capability entries, not
  assumed to be uniform.

- **`blue_green` vs. `canary`.** Blue/green keeps full old and new environments alive
  simultaneously, which requires double the resource budget during cutover but gives a clean,
  instant rollback path (flip traffic back). Canary shifts a traffic fraction incrementally, which
  is cheaper on resources but requires metric gates to be operational and makes rollback a traffic-
  weight adjustment rather than a clean swap. For this repo's current scale, blue/green is simpler
  to reason about and has a more deterministic rollback story, but it depends on the provider
  supporting simultaneous slot existence.

- **`manual_approval` gates as a canary stand-in.** Using `phased` mode with `manual_approval`
  gates at phase boundaries is a lower-infrastructure alternative to true `canary` if metrics are
  not yet available. The operator manually confirms each phase is healthy before advancing. This
  avoids the metric dependency but shifts the gate evaluation burden to humans and breaks the
  automated deployment story.

- **Updating capability entries atomically with publisher implementations.** The design doc
  requires that a provider adapter not widen support beyond its capability contract without updating
  the authoritative registry entry first, and that the provider-capabilities doc be re-rendered in
  the same change. Any rollout-mode addition must therefore ship as a single reviewed PR that
  updates the capability entry, adds the publisher implementation, adds the front-door validation,
  and re-renders the capabilities doc. Splitting these across PRs risks a window where a mode is
  declared in `TARGETS` but rejected at admission or silently mis-executed.

## Considerations

- The rollout-mode vocabulary is closed at eight values in `deployment-rollout.ts`. If a provider
  needs a mode not in that set, the vocabulary must be extended there first and the closed-set
  validators in `contract-extract-shared.ts` updated before any provider relies on the new value.

- The design doc states that for any mode other than `all_at_once`, `all_or_nothing`,
  `ordered_best_effort`, or `parallel_best_effort`, the policy must declare at least ordered
  phases/steps, the advance gate for each phase, abort behavior, and smoke mode (`per_phase`,
  `final_only`, or `both`). This is the minimum schema that must be extractable from `TARGETS`
  for any deployment that adopts `canary`, `blue_green`, or `phased`.

- Protected/shared multi-component deployments must declare `rollout_policy` explicitly even when
  the intended behavior matches the provider default. This is already enforced for `nixos-shared-
host` and `kubernetes` multi-component shapes. Any deployment that is promoted from
  single-component to multi-component must add an explicit `rollout_policy` at the same time.

- The `cloudflare-containers` capability entry explicitly defers advanced rollout to "a later
  reviewed live publisher contract." This task is the appropriate moment to make that decision
  concrete. The result should be a updated capability entry, not a note deferring the decision
  further.

- The `nixos-shared-host-progressive-rollout.ts` phase-state machine and the
  `nixos-shared-host-control-plane-progressive-guard.ts` supersedence guard are reference
  implementations that any new provider implementing `ordered_best_effort`, `phased`, `canary`, or
  `blue_green` should follow structurally, adapting the provider-specific slot and traffic-state
  details but keeping the same phase-state vocabulary and supersedence semantics.

- Rollout strategy affects artifact retention windows. A `blue_green` cutover with a soak window
  means the old slot's artifact must remain available for the full stabilization period before it
  is eligible for cleanup. The artifact retention policy (#26) must account for the longest soak
  window declared in any active `blue_green` or `canary` rollout.
