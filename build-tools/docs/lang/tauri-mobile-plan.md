# Tauri Mobile Target Implementation Plan

This plan implements [`tauri-mobile-design.md`](tauri-mobile-design.md). It adds explicit iOS and
Android targets for Rust Tauri apps while preserving the current desktop `tauri_app` contract and
sharing one Rust crate, frontend artifact, Tauri config, resources, capabilities, icons,
permissions, and app-command surface by default.

## Reviewed Context

- [`tauri-mobile-design.md`](tauri-mobile-design.md)
- [`../build-system-design.md`](../build-system-design.md)
- [`rust-design.md`](rust-design.md)
- [`docs/README.md`](../../../docs/README.md)
- [`../../../docs/handbook/getting-started-on-a-pr.md`](../../../docs/handbook/getting-started-on-a-pr.md)
- [`../../../docs/handbook/testing.md`](../../../docs/handbook/testing.md)
- [`../nixpkgs-source-selection-plan.md`](../nixpkgs-source-selection-plan.md)
- [`../../../docs/history/plans/external-deployments-plan.md`](../../../docs/history/plans/external-deployments-plan.md)
- [`../../../AGENTS.md`](../../../AGENTS.md)

## Non-Goals

- Do not change existing `tauri_app` behavior or make mobile support implicit.
- Do not use host Cargo, rustup, Node, Gradle, Android SDK, Xcode, keystores, provisioning profiles,
  or store credentials as fallback authority.
- Do not claim App Store or Play Store release support from local simulator, debug, or unsigned
  artifacts.
- Do not add arbitrary Tauri plugin support, Linux desktop Tauri, or Windows desktop Tauri.

## Implementation Guardrails

- Keep Buck as graph, impact, and route authority. Labels may aid inspection, but typed graph fields
  must carry target platform, artifact kind, identity, and signing mode.
- Keep mobile attrs scoped to Tauri routes. Non-Tauri Rust macros must reject mobile identity,
  project-source, artifact-kind, signing, and deployment fields.
- Keep Nix as reviewed tool and artifact authority. Missing Android or Apple SDK authority must fail
  during planning with an actionable diagnostic.
- Preserve shared-source defaults for desktop, iOS, and Android. Platform overrides must be explicit,
  package-relative, included in Buck action inputs, and visible to the planner.
- Local mobile build actions must not read Apple or Android release signing material.
- Release signing remains an external release-lane/admission boundary, not a normal `b` build path.
- Update source-owned macros, templates, generators, schemas, and docs. Do not edit generated
  workspace output as source of truth.

## Validation Policy

Each PR owns focused tests and docs for its behavior. Macro work must cover cquery analysis,
unknown-argument rejection, malformed mobile attrs, shared-source defaults, and graph export. Planner
work must cover selected and full graph routes, hostile environment stripping, unsupported host
rejection, and artifact-manifest shape. Scaffolding work must include fresh temp-consumer smokes for
each enabled mobile target. Deployment work must prove provider admission rejects local, simulator,
debug, unsigned, extension-only, and mismatched signed artifacts.

Run focused selectors for each PR. Run `i && b && ALL_TESTS=1 v` after PR-1, PR-2, PR-3, PR-4,
PR-5, PR-6, and PR-7, because those checkpoints change route inventory, graph/planner routing,
native mobile packaging, manifest/runtime enforcement, release admission, and the default scaffold
surface. Coverage remains opt-in unless a PR adds a coverage contract.

## Decision Gates

- Before PR-3, choose the first reviewed Android SDK, NDK, Build Tools, Java, Gradle, and Android
  Gradle plugin authorities.
- Before PR-3 and PR-4, run the pinned Tauri CLI twice from the same source input for Android and
  iOS and diff the emitted mobile projects. If generation is deterministic, keep it action-local. If
  it is not, require tracked normalized `gen/mobile/**` sources from a reviewed generator.
- Before PR-4, decide whether the first iOS slice is simulator-only or also includes unsigned device
  archives. The default plan assumes simulator-only.
- Before PR-6, decide whether `ios-unsigned-archive` is needed for external release admission.
- Before PR-5, define unsupported-host, missing-tool-authority, and misconfigured-host
  classifications for simulator and emulator probes, including which cases skip and which fail.
- Before any plugin-dependent app is scaffolded, define the narrow reviewed Tauri plugin contract.

## De-Risking Checkpoints

- After PR-1, mobile target metadata is queryable and exported, while existing desktop Tauri output
  remains unchanged.
- After PR-2, shared-source mobile scaffold inputs are deterministic and route inventory checks
  recognize that public mobile artifact macros remain disabled until their builders land.
- After PR-4, Android local and iOS simulator artifacts build only when reviewed SDK authority is
  available and never publish `run.prod`.
- After PR-5, mobile runnable and manifest enforcement is complete before release-admission work
  starts.
- After PR-6, signed mobile store artifacts have explicit admission evidence and providers reject
  local or unsigned artifacts.
- After PR-7, generated consumers can opt into desktop, iOS, and Android labels from one shared app
  source tree.

## Route-State Lifecycle

| Macro                | PR-1 load            | PR-2 load         | PR-3 load         | PR-4 load         | PR-7 load | Artifact state                             | Scaffold state   | Deployment                |
| -------------------- | -------------------- | ----------------- | ----------------- | ----------------- | --------- | ------------------------------------------ | ---------------- | ------------------------- |
| `tauri_app`          | public               | public            | public            | public            | public    | desktop artifact-producing                 | enabled          | desktop only              |
| `tauri_android_app`  | planned-not-loadable | loadable-disabled | public            | public            | public    | Android local artifact-producing from PR-3 | gated until PR-7 | never deployment-eligible |
| `tauri_ios_app`      | planned-not-loadable | loadable-disabled | loadable-disabled | public            | public    | iOS local artifact-producing from PR-4     | gated until PR-7 | never deployment-eligible |
| `tauri_mobile_suite` | planned-not-loadable | loadable-disabled | loadable-disabled | loadable-disabled | public    | aggregate-only helper                      | gated until PR-7 | not deployment-eligible   |

The `load` columns use only the planned-route inventory states: `public`, `loadable-disabled`, and
`planned-not-loadable`. Local/debug/simulator mobile macros never become deployment-eligible. PR-7
keeps scaffold enablement separate from deployment eligibility.

`loadable-disabled` means the symbol is exported from public `defs.bzl`, `load()` succeeds, and
analysis fails with a platform-not-enabled diagnostic before any artifact route is produced. The
planned-route inventory and `starlark-api.md` must mark those symbols as disabled, not active public
artifact routes.

| Release artifact    | PR-5         | PR-6                              | PR-7                               |
| ------------------- | ------------ | --------------------------------- | ---------------------------------- |
| signed `mobile-app` | not admitted | admitted by release-lane evidence | deployable only as signed artifact |

## Integration Debt Ledger

| Area                         | Introduced by        | Owner PR    | Status | Notes                                                                     |
| ---------------------------- | -------------------- | ----------- | ------ | ------------------------------------------------------------------------- |
| iOS device archive decision  | Design open question | PR-4/PR-6   | Open   | Simulator-only is the default until release admission needs archives.     |
| Mobile sidecar semantics     | Design open question | PR-5        | Open   | Keep sidecars rejected on mobile until a package-specific mapping exists. |
| Tauri mobile plugin contract | Design open question | Future plan | Open   | First slice supports only already-reviewed app commands and capabilities. |

## PR-1: Typed Mobile Target Metadata And Route Inventory

### 1. Intent

Add mobile-aware Tauri metadata to the Buck graph and Nix planner route without changing desktop
Tauri build behavior.

### 2. Scope of changes

- Add typed `tauri_target` fields for platform, artifact kind, bundle/package identity, signing
  mode, and deployment eligibility.
- Introduce Tauri-only public args or macro-specific allowed-arg validation rather than placing
  mobile fields in shared `RUST_PUBLIC_ARGS`; then thread accepted fields through
  `tauri_rule_attrs`, `prepare_tauri_contract`, planner-visible attrs, cquery export, inline export,
  `rust-kind-config.nix`, `planner/rust-tauri.nix`, `graph-generator.nix`, and `manifest.nix`.
- Keep `tauri_app` defaulting to the existing `desktop-darwin` `macos-app` behavior.
- Add a planned-route inventory separate from active public macro parity, with `public`,
  `loadable-disabled`, and `planned-not-loadable` states. Update route docs, `starlark-api.md`,
  `nix-gaps` tooling, route-parity tests, and `langs.json` so planned macros are not public routes.

### 3. Tests

- cquery and inline graph exports include identical typed Tauri metadata for the existing desktop
  route.
- Synthetic planner fixtures reject malformed or unsupported mobile records until private mobile
  helpers exist.
- Unsupported platform names, unknown artifact kinds, deployment-eligible local artifacts, and
  malformed bundle/package identities fail during analysis or planning.
- Non-Tauri Rust macro tests prove every new mobile field and existing Tauri-only attrs are rejected
  by non-Tauri macros when the shared allowlist is refactored.
- Existing desktop Tauri fixture still emits the current `desktop-app` runnable.

### 4. Acceptance Criteria

- Mobile metadata is visible before mobile artifact builders exist.
- Desktop Tauri outputs and runnable manifests are unchanged.
- Route inventory gates recognize planned mobile macros in their separate planned-route inventory and
  fail on stale docs or matrices without advertising them as active public macros.
- `starlark-api.md` documents planned mobile macros only as pending/feature-gated until the builder
  PR exports them.

### 5. Risks

- Metadata can diverge between cquery and inline export.
- Planner defaults can accidentally classify desktop Tauri as mobile or vice versa.

### 6. Consequence Of Not Implementing

Mobile targets cannot be routed or rejected consistently by Buck, Nix, manifests, or deployments.

### 7. Recommendation

Implement first.

## PR-2: Mobile Macro Contract And Shared-Source Scaffolding

### 1. Intent

Add the shared-source mobile declaration contract and scaffold rendering without exposing public
artifact-producing mobile macros before builders exist.

### 2. Scope of Changes

- Export disabled `tauri_ios_app`, `tauri_android_app`, and `tauri_mobile_suite` symbols whose
  `load()` succeeds but analysis fails until their platform builder PR lands.
- Define the final suite contract: stable `:<name>_desktop`, `:<name>_ios`, and
  `:<name>_android` labels backed by one crate, frontend, config, resources, capabilities, icons,
  permissions, and app commands unless an override is declared.
- Add package-relative attrs for `android_config`, `ios_config`, `android_project_srcs`, and
  `ios_project_srcs`; include them in `srcs`, action inputs, and planner contracts.
- Extend `build-tools/tools/scaffolding/templates/rust/tauri-app` with `targets`, Android identity
  and SDK levels, iOS identity and deployment target, and release-placeholder opt-in, but keep mobile
  generation behind an explicit scaffold feature gate independent of macro export.
- Add a double-generation evidence schema: pinned CLI digest, SDK/tool identities, source fixture
  digest, normalized diff digest, and action-local versus tracked-source decision.

### 3. Tests

- Helper and rejected-public-surface tests cover shared defaults, explicit overrides, malformed
  paths, duplicate resources, wildcard capabilities, unreviewed plugin declarations, and
  signing-secret attrs.
- cquery and inline graph exports include identical typed Tauri metadata for private mobile helper
  fixtures that remain outside the public macro surface.
- PR-2 extends the PR-1 non-Tauri rejection matrix across `rust_binary`, `rust_library`, tests,
  crate-kind macros, and extension macros as the final mobile helper attrs are added.
- Template tests render desktop-only `TARGETS` and prove mobile requests fail closed before macro
  enablement.
- A temp-consumer scaffold smoke proves desktop-only output is unchanged and mobile opt-in fails with
  the expected platform-not-enabled diagnostic.
- Determinism tests record Android/iOS double-generation evidence.

### 4. Acceptance Criteria

- The final mobile target shape is documented and tested without exporting artifact-producing mobile
  macros early.
- Mobile source attrs are package-relative and ready for builders.
- Mobile scaffold rendering remains disabled by feature gate even if one platform macro is exported.
- No public mobile artifact build path exists before PR-3 and PR-4.

### 5. Risks

- The suite helper could hide per-platform labels or make overrides ambiguous.
- Scaffold defaults could accidentally change current desktop-only projects.

### 6. Consequence Of Not Implementing

Mobile support would require ad hoc target definitions and could not preserve a reviewed shared
source contract.

### 7. Recommendation

Implement after metadata transport exists.

## PR-3: Android Local Artifact Builder

### 1. Intent

Build reviewed Android local artifacts from shared Tauri source with offline tool authority and no
release credentials.

### 2. Scope Of Changes

- Split `rust-tauri.nix` into `rust-tauri-common.nix`, `rust-tauri-darwin-desktop.nix`, and
  `rust-tauri-android.nix`, with no desktop behavior change.
- Export public `tauri_android_app` only after the Android planner/build contract fails closed or
  builds reviewed local artifacts.
- Provide reviewed Nix authority for Cargo Tauri, Rust targets, Android SDK/NDK/Build Tools,
  Java/Gradle, Android Gradle plugin dependencies, and offline cache inputs.
- Generate Android project files action-locally only when current double-generation evidence matches
  the pinned CLI/tool inputs; otherwise consume tracked normalized `gen/mobile/android/**`.
- Emit `android-debug-apk` with deterministic `debug-local` signing plus
  stable root paths `app.apk` and `share/viberoots-tauri/artifact-manifest.json`. Defer
  `android-unsigned-aab` until PR-6.
- Record Android artifact evidence for Gradle inputs, package name, SDK levels, ABI list, signing
  mode, and platform-native signature/debug-key inspection.
- Add minimal `manifest.nix` artifact-kind branching before Android outputs exist so debug APKs
  never publish `run.prod` or deployment eligibility.
- Move shared hostile-environment scrubbing into `rust-tauri-common.nix` for desktop and mobile, then
  set only desktop and Android reviewed allowlist values after the scrub.

### 3. Tests

- Planner tests reject missing SDK authority, host Android SDK fallback, networked Gradle wrapper
  use, release keystore refs, and undeclared mobile project files.
- Android hostile-env tests seed the design scrub set plus poisoned HOME/XDG/temp caches
  (`~/.gradle`, `~/.android`, `~/.cargo`) and prove only reviewed Android allowlist values remain.
- Template-split tests prove existing desktop `.app` output and `desktop-app` manifest remain
  unchanged.
- Desktop hostile-env tests seed the design scrub set plus poisoned HOME/XDG/temp caches and prove
  only reviewed desktop values remain.
- Fixture builds produce debug APK metadata where SDK support exists.
- Artifact layout tests fail if Android output is discoverable only by search rather than stable
  `app.apk` and `share/viberoots-tauri/artifact-manifest.json` paths.
- Artifact evidence tests assert Gradle evidence, package name, SDK levels, ABI list, signing mode,
  and debug-signature inspection are present and tied to the artifact bytes.
- Manifest and deployment-entry tests prove Android debug artifact roots do not publish `run.prod`
  and are rejected if passed as deployment artifact dirs.

### 4. Acceptance Criteria

- Android local artifacts build only from reviewed Nix and declared source inputs.
- Android local artifact roots expose stable `app.apk` and manifest paths.
- Debug signing is deterministic, non-secret, and rejected by deployment admission.
- The Android project source decision is backed by recorded double-generation evidence or reviewed
  normalized tracked source.
- Missing or stale double-generation evidence fails Android planning.
- Existing desktop Tauri behavior remains unchanged after the common-module split.
- Desktop Tauri restores only reviewed post-scrub values and cannot see ambient Android, Java,
  Gradle, Cargo, Rust, Tauri, or Apple/Xcode variables.

### 5. Risks

- Gradle or Android tooling can try to read host caches or network resources.
- Tauri-generated Android projects may contain nondeterministic files.

### 6. Consequence Of Not Implementing

Android targets remain declarations with no buildable local artifact path.

### 7. Recommendation

Implement after scaffold and route metadata are stable.

## PR-4: iOS Simulator Artifact Builder

### 1. Intent

Build reviewed iOS simulator artifacts from shared Tauri source without Apple signing material.

### 2. Scope Of Changes

- Add `rust-tauri-ios.nix` and keep `rust-tauri-darwin-desktop.nix` behavior unchanged.
- Export public `tauri_ios_app` only after the iOS planner/build contract fails closed or builds
  reviewed simulator artifacts.
- Define reviewed Xcode authority: discovery source, version/build allowlist,
  `xcrun`/`xcodebuild`/`simctl` path, Nix values, and skip/fail cases.
- Generate iOS project files action-locally only when current double-generation evidence matches the
  pinned CLI/tool inputs; otherwise consume tracked normalized `gen/mobile/ios/**`.
- Emit `ios-simulator-bundle` with stable root paths for simulator `app.app` and
  `share/viberoots-tauri/artifact-manifest.json`, plus bundle id, SDK, destination, architectures,
  and `unsigned-local` signing mode.
- Add minimal `manifest.nix` branching for `ios-simulator-bundle` before iOS outputs exist, with no
  `run.prod`, no deployment eligibility, and stable artifact-root manifest wiring.
- Record iOS artifact evidence for normalized Xcode build settings, bundle identifier, SDK,
  destination, architectures, signing mode, and platform-native unsigned inspection.
- Leave iOS runnable entries absent or disabled until PR-5 owns mobile runnable schema and
  `run-runnable` enforcement.
- Reuse the common hostile-environment scrub and set only reviewed iOS Apple/Xcode allowlist values
  after the scrub.

### 3. Tests

- Planner tests reject Apple team ids, certificates, provisioning profiles, App Store keys, host
  Xcode fallback, unsupported hosts, and undeclared project files.
- iOS hostile-env tests seed the design scrub set plus poisoned HOME/XDG/temp caches and prove only
  reviewed iOS Apple/Xcode allowlist values remain.
- Fixture builds produce simulator app metadata where reviewed simulator authority exists.
- Artifact layout tests fail if iOS output is discoverable only by search rather than stable
  `app.app` and `share/viberoots-tauri/artifact-manifest.json` paths.
- Artifact evidence tests assert Xcode settings, bundle identifier, SDK, destination, architectures,
  signing mode, and unsigned inspection are present and tied to the artifact bytes.
- Manifest and deployment-entry tests prove iOS simulator artifact roots do not publish `run.prod`
  and are rejected if passed as deployment artifact dirs.

### 4. Acceptance Criteria

- iOS simulator artifacts build only where reviewed host capability exists.
- iOS simulator artifact roots expose stable `app.app` and manifest paths.
- The iOS project source decision is backed by recorded double-generation evidence or reviewed
  normalized tracked source.
- Missing or stale double-generation evidence fails iOS planning.
- Local iOS builds never read signing secrets or publish store-deployable artifacts.
- Full validation checkpoint passes before later release-admission work starts.

### 5. Risks

- Xcode authority may not be fully Nix-provided and needs a precise reviewed host-capability model.
- Simulator tests can be host-sensitive.

### 6. Consequence Of Not Implementing

iOS targets remain declarations without a local development artifact path.

### 7. Recommendation

Implement after Android proves the common mobile project-source contract.

## PR-5: Mobile Runtime Manifests, Diagnostics, And Sidecar Policy

### 1. Intent

Make mobile artifact manifests, runnable manifests, and diagnostics complete enough for local use and
fail-closed policy enforcement.

### 2. Scope Of Changes

- Normalize Android and iOS `artifact-manifest.json` schemas.
- Extend the minimal PR-3/PR-4 `manifest.nix` branching with normalized schema fields for desktop,
  iOS simulator bundle, and `android-debug-apk` artifacts.
- Reserve and reject unsigned archive/AAB manifest enum values until PR-6 admission can bind them to
  release-lane evidence.
- Add runnable manifest schema fields for mobile timeout, host capability evidence, skip/fail
  classification, and dev/test-only mode.
- Add `run-runnable` enforcement for no `run.prod`, required timeout, required host-capability
  evidence, and rejection of unbounded mobile runnables.
- Create and validate explicit `ios-simulator-app` and `android-emulator-app` dev/test runnable
  entries.
- Reject desktop sidecar semantics on mobile until a reviewed platform mapping exists.
- Document artifact kinds, launcher modes, host-capability diagnostics, and sidecar rejection.

### 3. Tests

- Manifest tests cover all local artifact kinds and prove unsigned/debug artifacts lack `run.prod`.
- Rejection tests prove unsigned archive/AAB enum values and artifact roots cannot reach deployment
  entrypoints before PR-6.
- Runnable tests assert `ios-simulator-app` and `android-emulator-app` entries carry timeout,
  host-capability evidence, dev/test-only mode, no `run.prod`, and bounded `run-runnable` behavior.
- Diagnostic tests cover unsupported host skips, missing tool-authority failures, misconfigured-host
  failures, missing timeout rejection, missing capability evidence rejection, and sidecar rejection.
- Temp-consumer tests prove generated mobile manifests remain stable across rebuilds.

### 4. Acceptance Criteria

- Users can inspect why mobile targets are runnable, non-runnable, skipped, or rejected.
- Mobile local artifacts cannot be mistaken for production or store artifacts.
- Both mobile runnable kinds are explicit, bounded, and rejected if required dev/test metadata is
  missing.

### 5. Risks

- Host-capability checks can become flaky if they probe live simulator/emulator state too deeply.

### 6. Consequence Of Not Implementing

Mobile builds may exist but remain ambiguous to `p`, `d`, deployment extraction, and diagnostics.

### 7. Recommendation

Implement before release-admission work.

## PR-6: Signed Mobile Artifact Admission And Provider Binding

### 1. Intent

Connect mobile release artifacts to App Store Connect and Google Play only through explicit signed
artifact admission evidence.

### 2. Scope Of Changes

- Add signed `mobile-app` artifact manifest schema with platform, bundle/package id, signing model,
  signer identity, `releaseSigned`, `releaseAdmitted`, SBOM/provenance refs, unsigned-input digest,
  signed-output digest, and verification result.
- Require retained signed artifact roots with stable `app.ipa` or `app.aab`,
  `share/viberoots-tauri/artifact-manifest.json`, SBOM/provenance refs, and verification output.
- Add metadata-only release-lane admission adapters for retained signed IPA/AAB outputs.
- Add an in-PR gate: signed mobile admission schema tests, retained-artifact digest verification, and
  exact signed-output evidence must pass before provider publish, replay, rollback, retry, promotion,
  or exact-artifact paths are changed.
- Add `ios-unsigned-archive` and `android-unsigned-aab` as release-lane input artifacts only after
  provider admission rejects them as deployable evidence.
- Replace `admitMobileAppArtifact` and `admitGooglePlayArtifact`, plus normal deploy, replay,
  exact-artifact, service, and control-plane admission paths, so signed `mobile-app` manifests are
  mandatory before publish.
- Update deployment provider validation to parse signed manifests and reject extension-only `.ipa`
  or `.aab` evidence.
- Require provider target fields to match platform, bundle/package id, store compatibility, and
  release-admitted status.
- Bind SBOM/provenance evidence to the signed output digest, unsigned input digest, and signed
  manifest digest; store that manifest digest in the deployment admission record.
- Require replay, rollback, retry, promotion, and exact-artifact source-run resolution to re-bind the
  recorded signed manifest digest, signed-output digest, unsigned-input digest, platform,
  bundle/package id, signing model, signer identity, release-admitted status, provider target
  identity, and store compatibility against the retained bytes and current deployment target.

### 3. Tests

- Admission tests reject local, simulator, debug, unsigned, extension-only, mismatched, missing SBOM,
  missing provenance, and digest-mismatched artifacts.
- Root-layout tests reject signed admission unless the manifest is parsed from the retained root and
  its digest is recorded.
- Provider tests prove App Store Connect accepts only signed iOS `mobile-app` records and Google
  Play accepts only signed Android `mobile-app` records.
- Replay and exact-artifact tests prove old extension/hash records cannot bypass signed manifest
  admission and identity matching.
- Replay, rollback, retry, and promotion tests prove retained-artifact byte drift and path
  substitution fail even when platform and bundle/package id still match.
- Secret-safety tests prove local Buck/Nix/Cargo/Tauri builds never read signing credentials.

### 4. Acceptance Criteria

- Store providers cannot publish mobile artifacts admitted only by extension and hash.
- Release signing remains outside local build actions and inside protected release evidence.

### 5. Risks

- Admission schema can duplicate existing deployment artifact fields without a clear owner.
- Provider validation can become too permissive while preserving old extension-only behavior.

### 6. Consequence Of Not Implementing

Mobile store deployment would rely on weak artifact evidence and could publish the wrong artifact.

### 7. Recommendation

Implement before any production mobile deployment claim.

## PR-7: End-To-End Scaffold Enablement And Documentation

### 1. Intent

Enable opt-in scaffolded desktop+iOS+Android Tauri projects after the build, manifest, and admission
contracts are test-covered.

### 2. Scope Of Changes

- Turn on documented scaffold `targets` choices for desktop-only, desktop+iOS, desktop+Android, and
  desktop+iOS+Android.
- Add user-facing docs for shared source, platform overrides, local Android/iOS build limits,
  simulator/emulator launchers, sidecar policy, and release-admission boundaries.
- Add examples that show `tauri_mobile_suite` and separate `tauri_ios_app`/`tauri_android_app`
  labels without using signing credentials.
- Reassess whether `tauri_mobile_suite` should become the default scaffold shape; keep desktop-only
  default unless the full mobile evidence is retained.

### 3. Tests

- Fresh temp-consumer smokes for every scaffold target combination.
- Full route-inventory, scaffold-command, docs-command, manifest, and deployment contract coverage.
- Final `i && b && ALL_TESTS=1 v` plus plan/design assessment.

### 4. Acceptance Criteria

- A generated consumer can opt into shared-source desktop, iOS, and Android labels and get clear
  build or host-capability diagnostics.
- Current desktop-only Tauri scaffold output remains available and stable.
- The docs state exactly what is local, unsigned, debug, simulator, release-admitted, or deployable.

### 5. Risks

- Enabling too many scaffold combinations can broaden fixture cost and host sensitivity.
- Documentation can overstate mobile release capability if it does not mirror admission status.

### 6. Consequence Of Not Implementing

The build contracts may exist, but users cannot create reviewed mobile Tauri targets from `scaf`.

### 7. Recommendation

Implement last.

## Rollout And Sequencing

Land PRs in order. Do not enable mobile scaffolds before PR-7 unless a later plan update explicitly
adds platform-specific scaffold gates with matching evidence. Do not connect store providers before
PR-6 admission evidence. Keep desktop Tauri unchanged at every checkpoint. If an SDK authority
decision blocks a platform, leave that platform fail-closed and continue only with the other platform
when the skipped behavior is documented in this plan's ledger.

## Verification And Backout Strategy

Each PR should be revertible without changing the source contract of earlier PRs. Back out by
removing the newest macro exposure, planner branch, template option, or provider admission path while
leaving prior desktop behavior intact. Use focused tests to prove the reverted route fails closed,
then run the next required full-suite checkpoint from the parent workspace root.
