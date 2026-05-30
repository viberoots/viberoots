# Remote Build/Test Readiness Plan

This plan implements the inactive remote-build readiness work described in
[Remote Build/Test Readiness Design](/Users/kiltyj/Code/viberoots/remote-build-design.md).

Reviewed context:

- Remote builds and tests must remain disabled by default. `.buckconfig`, Jenkins defaults, local
  verify, and direct local `buck2 test` usage must stay local-only unless an explicit generated
  remote config and remote policy are selected.
- The first implementation phase is readiness work, not production enablement. It should add dormant
  Buck/Nix configuration surfaces, policy checks, tool closures, cache/materialization contracts,
  and local/dry-run validation without requiring RE credentials or remote machines.
- Buck remains the build/test scheduler. Repo code should pass verified configuration into Buck and
  inspect Buck-native evidence; it must not implement a custom remote action scheduler.
- Nix remains the tool/build/cache layer. External tools and runtimes used by remote-ready actions,
  workers, and CI helper flows must come from declared Nix outputs, not developer PATH, mutable
  worker images, package-manager installs, or globally installed CI tools.
- New substantive automation should be TypeScript zx scripts using `zx-wrapper`; shell should stay
  thin/delegating, and larger helpers should be split into focused modules rather than oversized
  files.
- Repo-owned test wrappers and Nix-backed build actions must remain local-only until their commands,
  source snapshots, Nix store paths, logs, coverage, and remote policy metadata are declared.
- Remote conformance may be added only for a tiny target that has already passed the policy gates.
  Broad remote execution, production credentials, worker fleet setup, and default CI remote lanes are
  outside this readiness plan.

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no default remote execution in committed `.buckconfig`
- no committed RE endpoints, tokens, cache keys, builder SSH paths, or provider credentials
- no production RE vendor selection
- no custom action scheduler, Nix substituter, or worker fleet control plane in this readiness phase
- no requirement for dynamic derivations, recursive Nix, or content-addressed derivations for remote
  readiness
- no remote execution for deployment-domain or external-mutating tests before locks, idempotency,
  fencing, recovery evidence, and credential scopes are implemented and tested
- no reliance on Homebrew, `/usr/local`, globally installed npm/pip/cargo tools, image-baked helper
  binaries, or developer PATH for remote-ready code paths

Verify-scope organization:

- Most PRs are `build-system-only` and should stay under `toolchains/**`, `build-tools/lang/**`,
  `build-tools/tools/dev/**`, `build-tools/tools/ci/**`, `build-tools/tools/remote-exec/**`,
  `build-tools/tools/nix/**`, `build-tools/tools/tests/**`, and repo-owned Buck wrapper files.
- New TypeScript automation should use existing helper APIs where possible, keep entrypoints
  centralized, and split modules before they exceed the repo's file-size guardrails.
- PRs that touch deployment-domain tests should only classify them as remote-ineligible unless a
  later design explicitly adds external-state contracts.
- If implementation discovers that a planned PR needs production infrastructure, live credentials,
  or provider-specific worker APIs, update this plan first and keep the implementation dormant.
- Each PR below must update this plan if implementation changes invalidate the remaining sequence,
  scope, or assumptions.

## PR-1: Default-local remote readiness policy checker

### 1. Intent

Add a reusable default-local policy checker that proves the repository remains local-only by default
while allowing inert remote-readiness files to exist.

### 2. Scope of changes

- Add `build-tools/tools/remote-exec/default-local-policy.ts`.
- Add a CLI/test entrypoint that inspects the repo's committed Buck, CI, and remote config surfaces
  and reports whether any remote execution path is selected by default.
- Model the allowed dormant surfaces in code so future config/profile/platform additions can be
  classified as inert or active.
- Check root `.buckconfig` for absence of `[buck2_re_client]` and committed remote
  `build.execution_platforms`.
- Check `toolchains//:remote_test_execution` has no selected `default_profile`.
- Check committed config templates and generated-config examples contain no real endpoints, tokens,
  signing keys, SSH key paths, cache credentials, or inline PEM material.
- Check Jenkins and CI stage defaults do not set `VBR_REMOTE_EXEC_MODE`,
  `VBR_REMOTE_BUCK_CONFIG`, `VBR_REMOTE_EXEC_SYSTEM`, or `VBR_REMOTE_ARTIFACT_DIR`.
- Check direct local Buck test entrypoints continue to use committed local config only, including
  developer-facing `buck2 test //...` invocations that do not pass an explicit generated remote
  config.
- Allow inert profile/platform definitions, renderers, and docs when they are not selected by
  default.

### 3. External prerequisites

- None. This PR must not require RE services, remote builders, cache credentials, or worker
  machines.

### 4. Tests to be added

- Add unit tests for the default-local policy checker covering `.buckconfig`, Jenkins remote env
  defaults, config-template redaction, and remote test toolchain default profile state.
- Add fixture tests proving inert profile/platform files are allowed while selected production
  remote config is rejected.
- Add a CI-facing test that runs the checker against the current repository.
- Add a direct-local Buck guard test or fixture proving `buck2 test //...` remains a local-config
  invocation unless the caller explicitly includes a generated remote config and policy.

### 5. Docs to be added or updated

- Add a short local-only invariants section to the remote build docs explaining what the checker
  protects and how future PRs should classify new dormant surfaces.
- Update `remote-build-plan.md` if the checker discovers additional default-local surfaces.

### 5.5. Expected regression scope

- `build-system-only`
- Keep changes limited to the checker, its tests, existing remote build docs, and this plan.

### 6. Acceptance criteria

- Local verify and CI defaults remain local-only.
- Direct local `buck2 test //...` remains usable without remote credentials or generated remote
  config.
- A future accidental commit of active RE client config, default profiles, remote CI env, or real
  credentials fails the checker and its tests.
- No developer needs remote credentials after this PR.

### 7. Risks

- Guard tests may overfit the current file layout and block legitimate inert config additions.

### 8. Mitigations

- Test behavior and selected defaults, not only exact file names.
- Keep explicit allowlists for inert templates and dormant config modules.

### 9. Consequences of not implementing this PR

Later readiness PRs could accidentally enable remote execution while adding dormant infrastructure,
and there would be no reusable checker for local/default policy.

### 10. Downsides for implementing this PR

It adds a policy checker before any remote functionality exists.

## PR-2: Generated remote Buck config renderer

### 1. Intent

Add a dormant renderer for remote Buck config files so future remote lanes can opt in through
generated, redacted, file-backed configuration instead of editing committed defaults.

### 2. Scope of changes

- Add `build-tools/tools/remote-exec/render-buckconfig.ts`.
- Render remote config snippets containing `[buck2_re_client]`,
  `[buck2_re_client.tls]`, optional `http_headers`, and `build.execution_platforms`.
- Accept explicit input fields for endpoint addresses, instance name, auth mode, target
  system/profile, fallback policy, and event-log/report output directory.
- Validate fallback policy values for strict-remote, hybrid, and local-only rendering without
  selecting any of them by default.
- Require output under an explicit artifact/config directory, not repo root.
- Validate mTLS values as file paths or environment references rather than inline PEM values.
- Validate `http_headers` as Buck's documented header list shape and reject token-looking inline
  bearer/API-key values.
- Validate rendered config keys against the pinned Buck2 version's supported remote config surface.
- Redact secret-looking values in logs and include only a config fingerprint in summaries.
- Keep renderer output unused unless `VBR_REMOTE_BUCK_CONFIG` is explicitly set by a later remote
  policy.

### 3. External prerequisites

- None. Renderer tests use fixtures only and do not contact RE endpoints.

### 4. Tests to be added

- Add renderer unit tests for local/no-op defaults, valid generated config, missing required fields,
  inline secret rejection, path validation, redacted logging, and stable fingerprinting.
- Add input validation tests for endpoint, instance, target system/profile, fallback policy, and
  event/report directory fields.
- Add pinned-config-key tests that fail if unsupported Buck config keys are rendered.
- Add guard tests proving generated config is not included by local verify or Jenkins defaults.

### 5. Docs to be added or updated

- Document the generated config inputs, redaction rules, and non-enablements in the remote build
  setup docs.
- Add an example fixture using fake endpoint names and fake environment references only.

### 5.5. Expected regression scope

- `build-system-only`
- Keep implementation under `build-tools/tools/remote-exec/**`,
  `build-tools/tools/tests/remote-exec/**`, and docs.

### 6. Acceptance criteria

- A fake remote config can be rendered and fingerprinted without credentials.
- The renderer rejects inline secrets and repo-root output.
- The renderer rejects unsupported config keys and unknown fallback policies.
- Local verify behavior is unchanged.

### 7. Risks

- Config templates could normalize unsafe secret formats or encourage checked-in credentials.

### 8. Mitigations

- Fail closed on token-looking values and keep examples fake/redacted.
- Keep generated files outside committed defaults.

### 9. Consequences of not implementing this PR

Remote enablement would require ad hoc Buck config edits or manual secret handling.

### 10. Downsides for implementing this PR

It introduces a config surface that remains dormant until later policy work connects it.

## PR-3: Dormant Buck remote profiles and execution platforms

### 1. Intent

Add analyzable Buck remote profile and execution-platform targets without selecting them by default.

### 2. Scope of changes

- Add `toolchains/remote_execution_profiles.bzl`.
- Add `toolchains/remote_execution_platforms.bzl`.
- Add named test profiles for:
  - `linux-x86_64-default`
  - `linux-x86_64-large`
  - `linux-aarch64-default`
  - `linux-aarch64-large`
  - `darwin-aarch64-default`
- Keep `toolchains//:remote_test_execution` with named profiles but `default_profile = None`.
- Set `default_run_as_bundle = False` explicitly so later default-profile experiments cannot
  accidentally change verify pass bundling semantics.
- Add an inactive `toolchains//:remote_execution_platforms` registration target returning
  `ExecutionPlatformRegistrationInfo`.
- Define remote-capable `ExecutionPlatformInfo.executor_config` values with explicit
  `remote_enabled`, `local_enabled`, and `use_limited_hybrid` settings for the selected lane policy.
- Set build execution `remote_execution_use_case = "buck2-build"` and use the same worker capability
  vocabulary as test profiles through `remote_execution_properties`.
- Keep a local fallback execution platform with `local_enabled = True` and `remote_enabled = False`.
- Include only Prelude-supported profile keys:
  `capabilities`, `listing_capabilities`, `local_listing_enabled`, `local_enabled`, `use_case`,
  `remote_cache_enabled`, `dependencies`, `resource_units`, and
  `remote_execution_dynamic_image`.
- Require `capabilities` and `use_case` in every named profile because Prelude's
  `get_re_executors_from_props(ctx)` consumes those keys.
- Keep repo-only concepts such as worker image, fallback policy, platform alias, and provider
  identity outside the profile map.

### 3. External prerequisites

- None. Analysis must not require an RE endpoint.

### 4. Tests to be added

- Add Starlark/schema tests for profile key closure, required key presence, profile names, and
  unknown-key rejection.
- Add profile conversion tests proving each named profile can be consumed by
  `get_re_executors_from_props(ctx)` without unexpected-key failures.
- Add tests proving `default_profile = None` and `default_run_as_bundle = False` on the committed
  default remote test execution toolchain.
- Add analysis tests proving `toolchains//:remote_test_execution` and
  `toolchains//:remote_execution_platforms` analyze locally without credentials.
- Add execution-platform schema tests proving build platforms set explicit local/remote/hybrid
  fields, use-case, and capability properties.
- Add guard tests using `buck2 audit execution-platform-resolution` proving ordinary local execution
  platform resolution is unchanged unless an opt-in config selects the remote platform target.

### 5. Docs to be added or updated

- Document the profile vocabulary and the distinction between test profiles and build execution
  platforms.
- Update the remote setup docs to state that profiles are inert until selected by generated config
  or target/toolchain activation.

### 5.5. Expected regression scope

- `build-system-only`
- Keep changes in `toolchains/**`, focused Starlark tests, and remote build docs.

### 6. Acceptance criteria

- Dormant profiles and execution platforms analyze locally.
- No default profile is selected and default bundling stays disabled.
- Build execution platforms carry explicit executor settings and share the reviewed capability
  vocabulary with test profiles.
- Every named test profile converts through Prelude's RE helper without unexpected-key failures.
- Unknown profile keys fail before Prelude conversion can fail during remote analysis.

### 7. Risks

- A committed remote platform target could be mistaken for active remote execution.

### 8. Mitigations

- Pair the platform targets with PR-1 guard tests and explicit docs that selection requires an
  opt-in generated config.

### 9. Consequences of not implementing this PR

Generated config would have no reviewed Buck targets to select later.

### 10. Downsides for implementing this PR

It adds dormant Buck configuration surface before any target can safely run remotely.

## PR-4: Verify remote execution policy plumbing

### 1. Intent

Teach verify to parse, validate, and carry a remote execution policy while preserving local behavior
as the default.

### 2. Scope of changes

- Add remote policy parsing in `build-tools/tools/dev/verify/args.ts`.
- Support:
  - `VBR_REMOTE_EXEC_MODE=local|hybrid|remote|remote-only-conformance`
  - `VBR_REMOTE_BUCK_CONFIG=<path>`
  - `VBR_REMOTE_EXEC_SYSTEM=x86_64-linux|aarch64-linux|aarch64-darwin`
  - `VBR_REMOTE_ARTIFACT_DIR=<path>`
  - optional `VBR_REMOTE_TEST_PROFILE_<PASS_NAME>=<profile>`
- Add `VerifyExecutionPolicy` to verify pass planning and pass it through `runVerify`,
  `runVerifyBuckPasses`, and `spawnVerifyBuck2Tests`.
- Validate remote policy before local housekeeping, coverage setup, seed preparation, daemon/watchdog
  startup, prewarm, or local tool-path computation.
- Split accepted verify setup into explicit local and remote-safe branches. Local mode keeps current
  housekeeping, prewarm, seed, and `computeZxTestNodeModulesOut` behavior; remote mode skips
  local-only preparation or replaces it with declared source snapshots, cache/materialization
  manifests, and worker-tool closure references.
- Reject remote+coverage requests until PR-14's declared coverage artifact contract is implemented.
- Map Nix system names to profile prefixes:
  - `x86_64-linux` -> `linux-x86_64`
  - `aarch64-linux` -> `linux-aarch64`
  - `aarch64-darwin` -> `darwin-aarch64`
- Keep `threadsOverride` independent from remote resource class.
- Carry target-platform/cquery configuration policy so target expansion, policy checking, and Buck
  invocation agree on configured targets.

### 3. External prerequisites

- None. Remote policy tests use fake config paths and fixtures.

### 4. Tests to be added

- Add parser tests for local default, each remote mode, missing config, relative/unsafe config paths,
  unknown modes, unknown systems, and per-pass profile overrides.
- Add ordering tests proving rejected remote requests fail before local side effects.
- Add setup-branch tests proving accepted remote mode does not compute or forward local
  `zx`/`node_modules` tool paths unless represented by a worker-tool closure or declared artifact.
- Add tests proving remote+coverage is rejected before local coverage directories or raw coverage
  paths are created.
- Add pass mapping tests proving supported systems map to existing profile names and never produce
  Nix-style profile names such as `x86_64-linux-default`.
- Add target-platform/cquery tests proving remote target expansion and Buck invocation use matching
  config policy.

### 5. Docs to be added or updated

- Document the remote policy environment variables and local default behavior.
- Add troubleshooting text for policy rejection before local side effects.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are under `build-tools/tools/dev/verify/**`,
  `build-tools/tools/tests/dev/**`, `build-tools/tools/tests/remote-exec/**`, and docs.

### 6. Acceptance criteria

- Existing `v` output and local pass planning are unchanged.
- Remote policy can be parsed and validated without contacting remote services.
- Invalid remote policy fails before local-only verify setup starts.

### 7. Risks

- Remote policy could become log-only metadata that does not affect Buck invocation.
- Early validation could accidentally block local verify.

### 8. Mitigations

- Keep default policy as `mode: "local"`.
- Add tests proving remote mode is connected to later argv/policy gates before Buck runs.

### 9. Consequences of not implementing this PR

Remote execution would require bypassing verify or passing ad hoc flags directly to Buck.

### 10. Downsides for implementing this PR

It adds policy plumbing before any target is remote-ready.

## PR-5: Verify Buck invocation and artifact wiring

### 1. Intent

Centralize remote Buck flags and artifact paths in `spawnVerifyBuck2Tests` without changing local
Buck command lines.

### 2. Scope of changes

- Update `build-tools/tools/dev/verify/buck2-test.ts` to consume `VerifyExecutionPolicy`.
- Keep local-mode argv unchanged.
- In explicit remote modes, add verified flags:
  - `--config-file <generated-config>`
  - `--prefer-remote` for hybrid/prefer-remote lanes
  - `--remote-only` only for conformance lanes
  - `--unstable-allow-compatible-tests-on-re`
  - `--event-log <path>.pb.zst`
  - `--build-report <path>.json`
  - `--write-build-id <path>.txt`
  - `--command-report-path <path>.json`
- Add optional debug controls under the artifact directory:
  - `--test-executor-stdout <path>.log`
  - `--test-executor-stderr <path>.log`
  - optional `--materialize-failed-inputs`
  - optional `--materialize-failed-outputs`
- Keep failed input/output materialization disabled by default and retention-scoped when enabled.
- Ensure remote invocations do not suppress requested event logs through inherited
  `RUST_LOG` / `BUCK_LOG` overrides.
- Record selected config fingerprint and profile without logging secrets.

### 3. External prerequisites

- None. Tests inspect argv/env snapshots only.

### 4. Tests to be added

- Add local argv snapshot tests proving existing command construction is unchanged.
- Add remote argv snapshot tests for `hybrid`, `remote`, and `remote-only-conformance`.
- Add negative argv tests proving remote mode never emits `--unstable-allow-all-tests-on-re`.
- Add artifact path tests proving reports, event logs, build IDs, test-executor logs, and
  materialization paths live under `VBR_REMOTE_ARTIFACT_DIR`.
- Add env tests proving explicit event logs are not suppressed by verify logging overrides.
- Add redaction tests for config/profile logging.

### 5. Docs to be added or updated

- Document remote Buck flags, artifact outputs, debug materialization defaults, and retention
  expectations.
- Add examples showing fake artifact paths and redacted config fingerprints.

### 5.5. Expected regression scope

- `build-system-only`
- Keep changes under verify Buck invocation code, remote-exec tests, and docs.

### 6. Acceptance criteria

- Local `spawnVerifyBuck2Tests` argv is unchanged.
- Remote argv uses only reviewed Buck flags.
- Remote artifact/debug outputs are deterministic, redacted, and disabled where risky by default.

### 7. Risks

- Remote flags could be added in modes where they are not valid.
- Event logs could still be suppressed by logging env.

### 8. Mitigations

- Snapshot each mode exactly.
- Test argv and env together.

### 9. Consequences of not implementing this PR

Remote runs would not have reliable Buck evidence or artifact capture.

### 10. Downsides for implementing this PR

It increases verify command-construction complexity for a dormant path.

## PR-6: CI buck-test delegation through verify

### 1. Intent

Stop CI `buck-test` from bypassing verify planning so future remote policy and local pass semantics
share one execution path.

### 2. Scope of changes

- Change `build-tools/tools/ci/run-stage.ts --stage buck-test` to delegate to the verify
  orchestration used by `v`, or extract the shared verify runner into a callable library.
- Preserve requested scope resolution.
- Preserve coverage environment passthrough.
- Preserve CI timeout behavior.
- Use `resolveVerifyTargetPlan`.
- Call `runVerifyTargetPasses` / `spawnVerifyBuck2Tests` instead of raw `buck2 test`.
- Allow future remote policy env vars to flow through this path without setting them by default.
- Classify remaining direct CI Buck invocations, including `cpp-addon-smoke`, as explicitly
  local-only or convert them to verify when their temporary workspaces can carry remote policy.
- Scrub broad remote env vars before explicitly local-only direct Buck smoke stages.

### 3. External prerequisites

- None. CI remains local-only.

### 4. Tests to be added

- Add `buck-test` stage tests proving it uses verify pass planning and preserves scope selection.
- Add coverage-mode tests proving `COVERAGE=1` still reaches verify.
- Add direct Buck invocation inventory tests requiring each direct call site to be routed through
  verify or marked local-only with remote env scrubbing.
- Add Jenkins/default env guard coverage for no remote env settings.

### 5. Docs to be added or updated

- Update CI docs to describe `buck-test` as verify-planned.
- Document the local-only classification for remaining direct Buck smoke stages.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are under `build-tools/tools/ci/**`, `build-tools/tools/dev/verify/**`,
  `build-tools/tools/tests/**`, `Jenkinsfile` only if needed for comments/env preservation, and
  docs.

### 6. Acceptance criteria

- Jenkins/local `buck-test` still runs locally.
- CI pass partitioning matches verify semantics.
- No direct CI Buck stage inherits remote env accidentally.

### 7. Risks

- CI timing or output could change when moving from raw Buck to verify planning.

### 8. Mitigations

- Preserve scope, timeout, coverage, and logging behavior with tests.
- Keep direct smoke stages local-only until they can support remote policy.

### 9. Consequences of not implementing this PR

Future remote lanes would have two divergent Buck execution paths.

### 10. Downsides for implementing this PR

CI `buck-test` becomes coupled to verify internals.

## PR-7: Remote test profile activation mechanism

### 1. Intent

Make verify-selected remote profile names capable of reaching Buck analysis without setting a
default remote profile on the committed local toolchain.

### 2. Scope of changes

- Add one dormant activation mechanism:
  - preferred: expose `remote_execution` through repo-owned test macros and add an explicit
    generated/remote-only target selection layer that sets `remote_execution = "<profile>"`; or
  - acceptable: add alternate remote test execution toolchain targets with `default_profile` set and
    select them only through generated remote config.
- Keep the committed default `toolchains//:remote_test_execution` with `default_profile = None`.
- Make verify remote mode fail before Buck if a pass maps to a profile but no activation mechanism
  is selected.
- Ensure activation files/configs contain only profile names and toolchain labels, not RE endpoints
  or credentials.

### 3. External prerequisites

- None. Activation tests use analysis/cquery only.

### 4. Tests to be added

- Add local analysis tests proving the default toolchain still has no default profile.
- Add focused cquery/provider tests proving a target using `linux-x86_64-default` produces executor
  fields through `get_re_executors_from_props(ctx)`.
- Add verify failure tests for profile mappings that are not connected to activation.
- Add generated activation redaction tests.

### 5. Docs to be added or updated

- Document the chosen activation path and why profile maps alone are inert.
- Update remote setup examples to avoid setting a default profile on committed local toolchains.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are under `toolchains/**`, repo-owned test macro files if needed,
  verify policy code, focused Buck/Starlark tests, and docs.

### 6. Acceptance criteria

- Local analysis remains local-only.
- Remote mode fails if profile selection cannot reach Buck analysis.
- A focused target can demonstrate executor field propagation without contacting RE.

### 7. Risks

- Activation could accidentally apply to every compatible test once a remote config exists.

### 8. Mitigations

- Keep committed default profile unset.
- Require explicit generated activation and test local defaults.

### 9. Consequences of not implementing this PR

Verify remote profile settings would be inert metadata.

### 10. Downsides for implementing this PR

It adds another indirection layer between verify passes and Buck analysis.

## PR-8: Repo-owned test wrapper executor propagation

### 1. Intent

Wire Buck remote executor fields through repo-owned external-runner test wrappers while keeping every
wrapper local-only by default.

### 2. Scope of changes

- Update repo-owned wrappers:
  - `build-tools/tools/buck/zx_test.bzl`
  - `build-tools/node/private/nix_test.bzl`
  - `build-tools/go/private/nix_test.bzl`
  - `build-tools/python/private/nix_test.bzl`
  - `build-tools/cpp/private/nix_test.bzl`
- Load `get_re_executors_from_props` from `@prelude//tests:re_utils.bzl`.
- Add standard remote test attrs from `@prelude//decls:re_test_common.bzl` where wrappers do not
  inherit them.
- Call `re_executor, executor_overrides = get_re_executors_from_props(ctx)`.
- Pass `default_executor` and `executor_overrides` into `ExternalRunnerTestInfo`.
- Explicitly set `run_from_project_root = True` and `use_project_relative_paths = True`.
- Preserve macro callsite defaults of `remote_execution = None`.
- Do not mark wrapper families `remote:ready` in this PR.

### 3. External prerequisites

- None. This is analysis/provider wiring only.

### 4. Tests to be added

- Add provider/cquery tests proving wrappers default to no executor when `remote_execution = None`.
- Add focused provider/cquery tests proving `remote_execution = "linux-x86_64-default"` produces
  executor fields.
- Add tests proving `run_from_project_root` and `use_project_relative_paths` are true for converted
  wrappers.
- Add regression tests proving local wrapper behavior and existing labels are preserved.

### 5. Docs to be added or updated

- Update wrapper/rule docs to describe `remote_execution` as inert by default and not proof of
  remote readiness.
- Add notes to remote setup docs that executor propagation is selection plumbing only.

### 5.5. Expected regression scope

- `build-system-only`
- Keep changes in repo-owned test wrapper Starlark, focused provider tests, and docs.

### 6. Acceptance criteria

- Existing tests still run locally by default.
- Explicit remote_execution attrs reach `ExternalRunnerTestInfo`.
- No wrapper is claimed remote-ready only because executor propagation exists.

### 7. Risks

- Adding remote attrs could alter macro signatures or label propagation unexpectedly.

### 8. Mitigations

- Keep defaults unchanged and cover macro/provider outputs with cquery tests.

### 9. Consequences of not implementing this PR

Remote-compatible Buck tests could not receive remote executor configs.

### 10. Downsides for implementing this PR

It exposes attrs that remain intentionally unusable for most targets until later PRs.

## PR-9: Remote-safe test environment handling

### 1. Intent

Split verify test environment construction into local and remote-safe modes so remote policies do
not forward host-local paths or mutable developer state.

### 2. Scope of changes

- Update `build-tools/tools/dev/verify/buck2-test-env.ts`.
- Keep local mode behavior unchanged.
- Add a remote env builder with an allowlist of values meaningful inside a remote action sandbox.
- Reject host absolute paths unless they are declared artifacts, Nix store paths from declared
  closures/materialization manifests, or remote-safe config files.
- Do not forward Nix daemon sockets, repo-root `buck-out` paths, local seed pin dirs, local
  `NODE_V8_COVERAGE`, `.direnv`, root `node_modules`, or developer override envs.
- Pass cache and worker config by declared file path or generated config reference.
- Compare Nix impure env allowlists in root `flake.nix` and
  `build-tools/tools/nix/flake/nix-config.nix` against the remote env builder.
- Reject undeclared environment-driven Nix inputs unless represented by source snapshots, graph
  artifacts, materialization manifests, or per-target policy fields.

### 3. External prerequisites

- None.

### 4. Tests to be added

- Add local env snapshot tests proving current local env is unchanged.
- Add remote env snapshot tests proving no repo-root `buck-out`, `.direnv`, `node_modules`, `/tmp`
  seed-stage path, Nix daemon socket, local coverage dir, or developer override env is forwarded.
- Add Nix impure-env allowlist tests proving new env inputs must be classified remote-safe or
  local-only.
- Add rejection tests for unsafe host absolute paths.

### 5. Docs to be added or updated

- Document local vs remote env behavior and the remote-safe env allowlist.
- Add guidance for adding future Nix impure env values.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are verify env code, Nix allowlist policy tests, and remote build docs.

### 6. Acceptance criteria

- Local verify env behavior is unchanged.
- Remote env contains only declared, remote-meaningful values.
- New remote-relevant Nix env inputs cannot be added without policy classification.

### 7. Risks

- The remote env allowlist may initially be too strict for local-like test workflows.

### 8. Mitigations

- Keep local mode unchanged and require remote-specific declarations for additional values.

### 9. Consequences of not implementing this PR

Remote tests would inherit local sockets, paths, coverage dirs, and developer state.

### 10. Downsides for implementing this PR

It introduces a second env construction path to maintain.

## PR-10: Remote readiness labels and action policy

### 1. Intent

Add Buck-visible remote readiness metadata and policy checks that default repo-owned wrappers/actions
to local-only.

### 2. Scope of changes

- Define labels:
  - `remote:local-only`
  - `remote:ready`
  - `remote:needs-source-snapshot`
  - `remote:external-readonly`
  - `remote:external-mutating-locked`
- Default repo-owned Nix-backed tests/build wrappers to `remote:local-only`.
- Fix label propagation for repo-owned wrappers that have a `labels` attr but do not pass it through
  to `ExternalRunnerTestInfo`, including Go, Python, and C++ Nix tests.
- Add `build-tools/lang/remote_action_policy.bzl`.
- Make repo-owned Nix-backed `ctx.actions.run` paths pass `local_only = True` by default or go
  through the shared policy helper.
- Apply the action policy helper to the Nix-backed build rule families called out by the design:
  - `build-tools/go/private/nix_build*.bzl`
  - `build-tools/python/private/nix_build.bzl`
  - `build-tools/cpp/private/nix_build.bzl`
  - `build-tools/rust/private/nix_build.bzl`
  - Node build/stage wrappers in `build-tools/node/*.bzl`
  - shared helpers in `build-tools/lang/nix_shell.bzl` and
    `build-tools/lang/nix_action_runner.bzl`
- Stamp action policy metadata for static checks whenever the helper classifies an action as
  local-only, hybrid, or remote-ready.
- Require remote-ready actions to prove declared source snapshot, materialization manifest, artifact
  contract, builder policy, remote-builder smoke evidence, and remote profile compatibility before
  the helper allows `local_only = False`.
- Require hybrid actions to include the same remote-ready evidence plus an explicit fallback reason.
- Add `build-tools/tools/dev/remote-exec-policy-check.ts`.
- Check remote mode cannot select `remote:local-only` targets.
- Check external mutating tests require lock capability.
- Keep deployment-domain tests and other external-state tests `remote:local-only` until action
  classes, locks, idempotency, fencing, recovery evidence, and credential boundaries exist.
- Check remote-ready tests have `run_from_project_root` and `use_project_relative_paths` true.
- Check resource labels map to valid profiles.
- Check every `remote:ready` label is attached only to an allowed rule family.
- Check Buck provider `local_resources`, `required_local_resources`, and `network_access` are
  rejected for remote-only conformance unless explicitly modeled by worker capability/egress/lock
  policy.
- Check remote-ready external-runner tests have declared command inputs and no required plain
  `$WORKSPACE_ROOT` lookups.

### 3. External prerequisites

- None. Policy checks use metadata and provider/cquery fixtures.

### 4. Tests to be added

- Add provider/cquery tests for wrapper label propagation and default `remote:local-only` metadata.
- Add policy tests rejecting `remote:local-only` in remote mode.
- Add provider/policy tests for `local_resources`, `required_local_resources`, and `network_access`.
- Add policy tests proving deployment-domain and external-mutating tests remain local-only unless a
  later design adds explicit external-state contracts.
- Add Starlark/text tests proving Nix-backed `ctx.actions.run` call sites pass `local_only = True`
  by default or use `remote_action_policy.bzl`.
- Add static tests covering the named Nix build rule families and shared Nix action helpers so a
  remote-relevant build path cannot bypass the policy helper by living outside the test wrappers.
- Add static tests proving the helper stamps policy metadata for local-only, hybrid, and
  remote-ready actions.
- Add resource-label/profile mapping tests.
- Add action-policy tests proving `local_only = False` is rejected without source snapshot,
  materialization, artifact, builder-policy, remote-builder-smoke, and profile-compatibility
  evidence.
- Add allowed-rule-family tests for `remote:ready` labels.

### 5. Docs to be added or updated

- Document remote readiness labels, their meaning, and how wrappers graduate from local-only.
- Document provider fields that block remote-only conformance.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files include wrapper Starlark, shared lang policy helpers, verify/policy tooling, tests,
  and docs.

### 6. Acceptance criteria

- Local verify ignores or reports policy informationally.
- Remote opt-in fails before Buck when policy is incompatible.
- No repo-owned Nix-backed action can become remote-scheduled accidentally.
- A Nix-backed action cannot opt out of `local_only` until every required remote-readiness artifact
  is declared and its builder policy has matching remote-builder smoke evidence.

### 7. Risks

- Label-based policy may be weaker than typed attrs.

### 8. Mitigations

- Default absence of readiness to local-only.
- Keep policy checks provider/cquery-backed and later allow migration to stricter attrs.

### 9. Consequences of not implementing this PR

Remote config could schedule local-assumption actions/tests without a reviewed readiness gate.

### 10. Downsides for implementing this PR

It adds policy friction before many targets can become remote-ready.

## PR-11: Declared external-runner command inputs

### 1. Intent

Move remote-relevant test command inputs onto actual external-runner command handles rather than
unrelated stamp actions or workspace string paths.

### 2. Scope of changes

- Update repo-owned wrappers so remote-ready mode can use `cmd_args`, `RunInfo`, or declared handles
  for scripts, helper launchers, templates, source snapshots, graph manifests, and generated config.
- Keep current local string/bootstrap paths only under local mode.
- Ensure helper launchers, shell scripts, interpreters, CLIs, and language runtimes used by
  remote-ready tests are execution deps, declared Buck artifacts, or Nix closure entries.
- Update `zx_test.bzl` to carry `script`, `template_inputs`, and helper scripts through the command
  handle for remote-ready mode.
- Update `node_nix_test`, `go_nix_test`, `python_nix_test`, and `cpp_nix_test` to attach Nix inputs,
  source snapshot placeholders, graph manifests, and selected-output manifests to the executed
  command rather than only to stamp actions.
- Keep wrappers `remote:local-only` until later source/materialization contracts are present.

### 3. External prerequisites

- None.

### 4. Tests to be added

- Add provider/cquery tests proving remote-ready wrapper commands contain declared handles for
  required files.
- Add policy tests rejecting remote-ready wrappers whose commands are plain workspace-path shell
  strings without declared handles.
- Add local wrapper regression tests proving existing local execution remains unchanged for
  `remote:local-only` targets.
- Add static tests rejecting ambient PATH dependency declarations in remote-ready wrapper commands.

### 5. Docs to be added or updated

- Document command-handle requirements for external-runner tests.
- Add wrapper examples showing local convenience mode versus remote-ready declared-input mode.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are repo-owned wrapper Starlark, policy checks, focused tests, and docs.

### 6. Acceptance criteria

- Remote policy can distinguish declared command inputs from local workspace strings.
- Local execution for unconverted wrappers remains unchanged.
- No wrapper is marked `remote:ready` solely by moving command handles.

### 7. Risks

- Command-handle rewrites could change local execution semantics.

### 8. Mitigations

- Keep local mode paths untouched and test local command snapshots.

### 9. Consequences of not implementing this PR

Buck could not materialize required external-runner files for remote execution.

### 10. Downsides for implementing this PR

It adds dual local/remote command construction complexity.

## PR-12: Nix no-link and builder policy classification

### 1. Intent

Make Nix command behavior explicit for remote-relevant paths by removing selected-build out-link
drift and classifying builder usage at call sites.

### 2. Scope of changes

- Add `--no-link` to selected-target build paths in `build-tools/tools/dev/build-selected.ts`,
  including trace and non-trace calls.
- Split verify seed builder into:
  - local mode with current `--out-link` pinning under `buck-out/tmp/verify-seed`
  - remote-ready mode with `--no-link --print-out-paths` and explicit artifact/cache manifest output
- Add `build-tools/tools/lib/nix-builder-policy.ts`.
- Add a matching Starlark helper or enum constant for Buck rule fragments that render Nix commands.
- Classify builder policy values:
  - `local_only`: append `--builders ""` and document why
  - `inherit_config`: do not pass `--builders`
  - `force_builders_file`: pass only generated builders file/config supplied by CI/smoke tooling
- Update known `--builders ""` call sites to declare a policy instead of embedding the flag ad hoc.
- Make remote policy reject `remote:ready` wrappers/actions that render `--builders ""`.
- Make remote policy reject `remote:ready` wrappers/actions that use `inherit_config` or
  `force_builders_file` without a matching remote-builder smoke report for the selected builder
  policy.

### 3. External prerequisites

- None. Remote builder smoke remains dry-run/local.

### 4. Tests to be added

- Add selected-build argv tests proving `--no-link` is present and a single store path is printed.
- Add verify seed tests proving local behavior remains unchanged and remote-ready mode uses
  `--no-link`.
- Add static tests finding unclassified production `--builders ""` usage.
- Add policy tests rejecting remote-ready actions that disable builders.
- Add policy tests rejecting remote-ready actions whose builder policy has no matching
  remote-builder smoke evidence.
- Add builder policy rendering tests for TypeScript and Starlark helpers.

### 5. Docs to be added or updated

- Document Nix builder policy values and when each is valid.
- Update remote setup docs for `.envrc` builder masking and remote-ready selected builds.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are Nix command helpers, verify seed/build-selected code, Nix wrapper Starlark,
  tests, and docs.

### 6. Acceptance criteria

- Selected builds use `--no-link`.
- Local bootstrap and temp-workspace flows retain local-only builder behavior.
- Remote-ready paths cannot silently disable configured builders.
- Remote-ready paths cannot claim builder compatibility without a matching remote-builder smoke
  report for their selected policy.

### 7. Risks

- Adding `--no-link` could affect scripts expecting `result` symlinks.

### 8. Mitigations

- Verify selected builds already consume printed store paths and cover that behavior with tests.

### 9. Consequences of not implementing this PR

Remote-capable Nix flows could create workspace out-links or suppress remote builders.

### 10. Downsides for implementing this PR

It requires touching several Nix command call sites that currently work locally.

## PR-13: Source snapshot contract

### 1. Intent

Provide a declared source snapshot contract for actions/tests that currently require a live checkout.

### 2. Scope of changes

- Add `build-tools/lang/source_snapshot.bzl`.
- Add `build-tools/tools/dev/source-snapshot.ts`.
- Define snapshot contents:
  - filtered repo source
  - `flake.nix` and `flake.lock`
  - declared graph artifact
  - necessary `TARGETS` and `.bzl` files
  - generated provider files
  - no `.git`, `.direnv`, root `node_modules`, mutable `buck-out`, or local temp dirs
- Make the snapshot a declared Buck input/output artifact.
- Update Nix-invoking wrappers to accept a source snapshot in remote-ready mode while preserving
  `WORKSPACE_ROOT` local mode.
- Add manifest fields distinguishing declared snapshot root from ambient worker checkout.
- Require remote-ready Nix attrs using `builtins.getEnv "WORKSPACE_ROOT"` to either consume a
  declared snapshot path/graph path or remain local-only.

### 3. External prerequisites

- None.

### 4. Tests to be added

- Add snapshot content tests proving required files are present and forbidden directories are absent.
- Add policy tests failing remote-ready wrappers that require implicit `WORKSPACE_ROOT` reads.
- Add static tests identifying Nix files that use `builtins.getEnv "WORKSPACE_ROOT"` and requiring a
  remote-safe exemption or local-only classification.
- Add static tests for new `builtins.getEnv` uses under `build-tools/tools/nix`.

### 5. Docs to be added or updated

- Document the source snapshot manifest format and allowed contents.
- Add guidance for converting Nix-invoking wrappers from live checkout to snapshot mode.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are source snapshot helpers, Nix wrapper integration points, policy/static tests,
  and docs.

### 6. Acceptance criteria

- A local conformance test can build a snapshot artifact for a tiny target.
- Remote policy rejects implicit live-checkout dependencies.
- Local mode can still use current `WORKSPACE_ROOT` behavior.

### 7. Risks

- Snapshot filtering may omit files needed by some generated Nix attrs.

### 8. Mitigations

- Start with one tiny target and expand with manifest-driven failures.

### 9. Consequences of not implementing this PR

Remote workers would need ambient checkouts, defeating Buck CAS input modeling.

### 10. Downsides for implementing this PR

Snapshot creation adds another artifact layer to remote-ready workflows.

## PR-14: Declared remote artifacts and coverage contract

### 1. Intent

Make logs, reports, coverage, and materialization evidence declared artifacts for remote-ready
wrappers while keeping local artifact behavior unchanged.

### 2. Scope of changes

- Add `build-tools/tools/remote-exec/artifact-contract.ts`.
- Define per-run/pass/target artifact directories, digest sidecars, redaction class, content type,
  and retention intent.
- Update remote Buck artifact handling from PR-5 to use the shared contract.
- Define wrapper artifact categories:
  - test stdout/stderr summaries
  - Nix build logs
  - selected output store-path manifests
  - raw coverage files
  - source snapshot manifests
  - remote conformance evidence
- Keep local mode writing existing logs.
- Make remote-ready wrappers copy important logs into declared outputs or Buck reports.
- Fail fast for remote+coverage until raw coverage is declared per test and verify aggregation can
  materialize it locally for `pnpm coverage:build`.
- Scope failed-input/output materialization with explicit retention and redaction policy.

### 3. External prerequisites

- None.

### 4. Tests to be added

- Add artifact contract unit tests for path layout, digest sidecars, redaction classes, and retention
  values.
- Add remote policy tests rejecting remote-ready targets that write only to undeclared local paths.
- Add coverage policy tests proving remote+coverage fails until declared coverage outputs exist.
- Add redaction tests for artifact summaries.
- Add materialization retention tests for failed-input/output debug artifacts.

### 5. Docs to be added or updated

- Document remote artifact layout, retention classes, redaction expectations, and coverage
  limitations.
- Update verify docs to explain local coverage remains unchanged.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are remote-exec artifact helpers, verify artifact integration, wrapper policy tests,
  coverage policy docs/tests, and remote build docs.

### 6. Acceptance criteria

- Remote-ready targets cannot rely only on `buck-out`, `/tmp`, or repo-root coverage writes.
- Local logs and coverage remain unchanged.
- Remote+coverage is rejected until declared outputs exist.

### 7. Risks

- Artifact path contracts may be too rigid for future providers.

### 8. Mitigations

- Keep provider-specific upload outside the artifact layout and store only redacted summaries.

### 9. Consequences of not implementing this PR

Remote runs would lose logs/coverage or write them to undeclared host paths.

### 10. Downsides for implementing this PR

It adds artifact bookkeeping before remote lanes exist.

## PR-15: Nix-provided worker and CI tool closures

### 1. Intent

Ensure every external tool/runtime dependency used by remote-ready workers, actions, and CI helper
flows is provided by declared Nix outputs.

### 2. Scope of changes

- Add `build-tools/tools/nix/flake/packages/remote-worker-tools.nix`.
- Export `packages.<system>.remote-worker-tools`.
- Optionally add `apps.<system>.remote-worker-bootstrap` to print/activate closure paths and run
  local worker prerequisite checks without registering with a real scheduler.
- Include conservative worker tools:
  - `bash`
  - coreutils/findutils/gnugrep/gnused/gawk
  - `git`
  - `nodejs_22`
  - `pnpm` if required by current wrappers
  - `buck2`
  - `zx-wrapper`
  - timeout provider
  - helper scripts needed by Nix-invoking actions
  - backend-selected RE worker daemon/sidecar packages once a backend is chosen, as separate Nix
    packages composed into worker closures
- Add `packages.<system>.remote-ci-tools`.
- Include CI/service tools used outside remote workers:
  - Nix CLI for cache publishing and smoke tests
  - `buck2` for run summaries and event-log helpers
  - Node runtime for TypeScript helper scripts
  - cache publisher clients/wrappers once selected
  - object-store/artifact upload clients once selected
  - metrics/log shipping wrappers only if repo invokes them directly
  - provider CLIs only when required and only as Nix packages
- Add primitive inventory policy for allowed non-Nix runtime prerequisites:
  kernel/sandbox support, disks, network reachability, mounted credentials/workload identity
  material, trust anchors, clocks, and minimal Nix bootstrap.
- Reject repo-invoked executables for SSH, workload identity, artifact upload, metrics/logging,
  provider access, cache publishing, or worker registration unless they are declared Nix outputs.

### 3. External prerequisites

- None for generic closures. Backend-specific packages can be placeholders until a provider is
  selected.

### 4. Tests to be added

- Add Nix build tests for `.#remote-worker-tools` on supported systems.
- Add Nix build tests for `.#remote-ci-tools` on supported CI systems.
- Add closure content tests for expected binaries and absence of secrets/host-specific paths.
- Add `remote-worker-bootstrap` tests proving it only activates Nix store paths and does not attempt
  scheduler registration by default.
- Add PATH restriction tests proving worker bootstrap and CI helper flows can run with PATH limited
  to declared Nix store closures plus non-executable primitives.
- Add static tests rejecting remote-ready scripts that invoke provider/cache/artifact CLIs not
  listed in declared closures.
- Add allowed primitive inventory tests that fail when an executable is treated as a primitive.

### 5. Docs to be added or updated

- Document `remote-worker-tools`, `remote-ci-tools`, backend-specific closures, and the allowed
  primitive inventory.
- Document `remote-worker-bootstrap` as a local bootstrap/check helper, not a scheduler
  registration command.
- Update worker image guidance to forbid baked repo tools, language runtimes, Buck binaries, helper
  CLIs, RE runtime binaries, worker registration tools, artifact/cache/metrics clients, and
  credentials.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are Nix package definitions, package exports, closure tests, remote-exec static
  tests, and docs.

### 6. Acceptance criteria

- Worker and CI helper closures build without live credentials.
- The optional worker bootstrap app runs local checks without registering a worker.
- Remote-ready scripts cannot depend on developer PATH, CI image global tools, or image-baked helper
  binaries.
- Only non-executable machine primitives remain outside Nix.

### 7. Risks

- Some provider CLIs or RE runtimes may not package cleanly in Nix.

### 8. Mitigations

- Keep backend-specific packages separate and optional until provider selection.
- Prefer APIs over CLIs where a CLI would add packaging risk.

### 9. Consequences of not implementing this PR

Remote readiness would depend on mutable worker/CI images and undeclared host tools.

### 10. Downsides for implementing this PR

It adds closure maintenance work before production workers exist.

## PR-16: Cache manifest publisher and remote builder smoke tooling

### 1. Intent

Add dormant cache publishing manifests and remote-builder smoke tooling without configuring any
production cache or builders.

### 2. Scope of changes

- Add `build-tools/tools/ci/publish-nix-cache-manifest.ts`.
- Build configured attrs with `--no-link --print-out-paths`.
- Archive flake inputs with `nix flake archive --json`.
- Write a manifest containing system, source revision, flake lock hash, attr names, output paths,
  cache endpoint identity, and tool versions.
- Support dry-run mode without pushing.
- Use Nix-provided tools from `remote-ci-tools`.
- Copy exact paths to a writable Nix store with Nix from a declared closure, or emit paths for
  Attic/Cachix/provider wrappers that are also declared Nix tools.
- Keep backend-specific credentials outside manifests.
- Include initial attrs:
  - `.#graph-generator`
  - `.#buck2-prelude`
  - `.#test-seed`
  - `.#remote-worker-tools`
  - `.#toolchains.go`
  - `.#toolchains.cxx`
  - `.#toolchains.python`
  - discovered `.#py-wheelhouse-*`
  - discovered `.#node-modules.*`
  - configured selected graph-materialization outputs and selected target outputs when a caller
    provides target/graph input
- Add `build-tools/tools/remote-exec/nix-remote-builder-smoke.ts`.
- Detect `.envrc` masking of `builders =`.
- Print effective Nix config relevant to builders, substituters, trusted keys, and `max-jobs`.
- Run `nix store info --store <builder-uri>` when a builder URI is explicitly provided.
- Run a small eligible build such as `.#graph-generator --no-link --rebuild` only when explicitly
  configured.
- Fail with actionable diagnostics that distinguish inherited builders, forced generated builders
  files/config, and intentionally disabled builders.
- Do not change global Nix config or set builders by default.

### 3. External prerequisites

- None for dry-run and parser tests. Live remote builder/cache use remains a later enablement step.

### 4. Tests to be added

- Add cache manifest dry-run tests for attr discovery, flake archive parsing, exact output paths,
  redaction, and backend wrapper command rendering.
- Add manifest tests for configured selected graph-materialization outputs and selected target
  outputs.
- Add tests proving credentials are not persisted in manifests.
- Add remote-builder smoke parser tests detecting empty builders from `.envrc`.
- Add remote-builder smoke command-rendering tests for `nix store info --store <builder-uri>`,
  effective config reporting, actionable diagnostics, and no global config mutation.
- Add remote-builder smoke command-rendering tests for the explicitly configured probe build,
  including `.#graph-generator --no-link --rebuild`, and prove the probe is not run unless
  requested.
- Add NIX_CONFIG parsing/rendering tests.
- Add PATH restriction tests proving cache publishing and smoke tooling use `remote-ci-tools`.

### 5. Docs to be added or updated

- Document cache manifest dry-run usage and initial attr set.
- Document remote builder smoke usage, `.envrc` masking, and required pre-exported `NIX_CONFIG`.
- Update wheelhouse preload docs to point at the generic manifest path or explain compatibility.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are CI cache tooling, remote-exec smoke tooling, Nix package references, tests, and
  docs.

### 6. Acceptance criteria

- Dry-run manifest generation works locally without credentials.
- Remote builder smoke reports effective builder configuration without enabling builders by default.
- Remote builder smoke emits a machine-readable report that remote-ready policy checks can match to
  `inherit_config` or `force_builders_file` builder policies.
- Existing `wheelhouse-preload` remains compatible or delegates to the new helper.

### 7. Risks

- Cache manifests could accidentally expose endpoint or credential material.

### 8. Mitigations

- Store endpoint identity/fingerprints rather than secrets and cover redaction with tests.

### 9. Consequences of not implementing this PR

Remote workers would lack a reviewed way to pre-populate cache paths and diagnose builder config.

### 10. Downsides for implementing this PR

It adds cache-publishing plumbing that initially runs only in dry-run mode.

## PR-17: Nix store materialization contract

### 1. Intent

Make remote-ready actions explicitly materialize required Nix store paths instead of assuming a warm
worker `/nix/store`.

### 2. Scope of changes

- Add `build-tools/tools/remote-exec/nix-store-materialize.ts`.
- Add `build-tools/lang/nix_store_materialize.bzl`.
- Define a manifest listing store paths, attr names, source revision, flake lock fingerprint,
  substituter endpoint identity, trusted public keys, and expected output identity.
- Realize each required path with `nix copy --from <substituter>` or remote-safe
  `nix build --no-link --print-out-paths` against a declared source snapshot.
- Verify realized output paths match the manifest before executing test/build commands.
- Emit declared materialization reports with path, nar hash where available, substituter used,
  duration, and cache-hit/miss classification.
- Fail remote mode when required `/nix/store/...` paths are referenced only as plain strings and not
  listed in a manifest.
- Keep helper dormant and usable locally for conformance tests.
- Do not install global substituters or write credentials into manifests.

### 3. External prerequisites

- None for parser/dry-run tests. Live substituter access is later enablement work.

### 4. Tests to be added

- Add manifest parsing, schema, redaction, command rendering, and path mismatch tests.
- Add policy tests rejecting remote-ready targets referencing `/nix/store/...` without a declared
  materialization manifest.
- Add local dry-run tests for `.#remote-worker-tools`, `.#test-seed`, and one selected target output.
- Add tests proving helper commands use Nix from declared closures and do not mutate global Nix
  config.

### 5. Docs to be added or updated

- Document materialization manifest schema and dry-run workflow.
- Add examples showing how remote-ready wrappers list required store paths.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are remote-exec materialization tooling, Starlark helpers, policy tests, and docs.

### 6. Acceptance criteria

- Remote policy can reject undeclared store-path dependencies.
- Materialization dry-runs are deterministic and redacted.
- No helper requires live cache credentials for unit tests.

### 7. Risks

- Store path manifests may drift from actual wrapper needs.

### 8. Mitigations

- Verify paths immediately before execution and fail on mismatch.

### 9. Consequences of not implementing this PR

Remote actions could fail on cold workers or rely on hidden store state.

### 10. Downsides for implementing this PR

It adds manifest overhead to every remote-ready Nix-backed action.

## PR-18: Buck remote evidence and first local conformance target

### 1. Intent

Add Buck-native evidence parsing and convert one tiny target to `remote:ready` for local/dry-run
conformance without enabling production remote execution.

### 2. Scope of changes

- Add `build-tools/tools/remote-exec/buck-event-log-remote-check.ts`.
- Use `buck2 log what-ran` where possible to classify actions as remote, cache, dep-file-cache,
  local, worker, or unknown.
- Fail remote conformance when remote-ready actions run locally unless explicitly allowed.
- Treat event-log JSON/JSONL/protobuf-derived schemas as pinned-version inputs, not stable public
  APIs.
- Add `build-tools/tools/remote-exec/buck-run-summary.ts`.
- Collect `what-ran`, `summary`, `critical-path` or `slowest-path`, `what-uploaded`, and
  `what-materialized` when supported by the pinned Buck2 version.
- Normalize redacted summaries containing selected profile, config fingerprint, target/pass, action
  counts, remote/cache/local classifications, slowest actions, and upload/materialization stats.
- Include cache/materialization provenance fields when available: cache endpoint identity, public key
  fingerprint, cache manifest digest, source revision, flake lock fingerprint, and Nix
  materialization report references.
- Treat unsupported Buck log subcommands as explicit version-gated fields, not silent success.
- Convert one tiny target to `remote:ready` only after source snapshot, command input,
  materialization, artifact, tool-closure, and policy requirements are satisfied.
- Add local/dry-run conformance flow for that target using fake/generated config and captured
  fixtures where no RE backend exists.
- Add an operator-facing enablement checklist section that explains the later, out-of-scope steps:
  provisioning RE/CAS/action-cache endpoints, worker pools, Nix cache credentials, generated CI
  secrets/config, cache warm paths, one-target remote-only conformance, rule-family expansion, CI
  lane promotion, macOS reporting parity, operational go/no-go checks, and the optional
  self-managed operations control plane decision.
- Include future live conformance checks in that checklist: the selected worker has no ambient
  checkout dependency, required Nix paths substitute or materialize from configured cache/manifests,
  artifacts are uploaded/redacted, and Buck/Nix/worker logs contain no secrets.
- Document that any self-managed operations control-plane code is intentionally deferred unless the
  selected RE provider does not supply fleet/run management, and that Buck2/RE remains the action
  scheduler if such a subsystem is later added.
- Do not add a default Jenkins remote lane.

### 3. External prerequisites

- None for fixture/local tests. A live RE backend is not required in this readiness PR.

### 4. Tests to be added

- Add event-log fixture tests for remote, cache-hit, local, worker, and unknown classifications.
- Add run-summary fixture tests for supported and unsupported Buck log subcommands.
- Add run-summary fixture tests for cache/materialization provenance fields and redaction.
- Add redaction tests for summaries.
- Add policy tests proving the tiny target is the only `remote:ready` target initially.
- Add local conformance tests proving the target has declared source snapshot, command inputs, Nix
  materialization manifests, artifact outputs, and Nix-provided tools.
- Add checklist consistency tests or docs checks proving the enablement checklist references only
  non-default, explicitly future remote lanes and does not introduce active CI env settings.
- Add checklist/docs checks proving future enablement requires worker no-ambient-checkout evidence,
  Nix substitution/materialization evidence, secret redaction checks, and macOS lane reporting parity
  before broader CI promotion.

### 5. Docs to be added or updated

- Document how to run local/dry-run conformance for the tiny target.
- Document Buck evidence interpretation, unsupported-command handling, and failure modes.
- Update the rule family matrix with the converted target and remaining local-only families.
- Document the future enablement sequence and operations-control-plane decision criteria alongside
  the conformance workflow.
- Document that the later macOS lane must produce equivalent Buck event log, artifact, coverage, and
  summary evidence even if it uses dedicated local/on-demand executors instead of remote RE.
- Add operator examples for rendering a redacted remote Buck config into `buck-out/tmp`, running the
  Nix remote-builder smoke tool, running cache manifest dry-run, and confirming local defaults remain
  local-only.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are Buck evidence tooling, one tiny target's wrapper/configuration, policy tests,
  fixtures, and docs.

### 6. Acceptance criteria

- Buck evidence tooling can fail conformance from fixture/local evidence.
- One tiny target is remote-ready by policy without enabling remote execution by default.
- No other target becomes remote-ready accidentally.

### 7. Risks

- Buck log subcommand behavior may differ across pinned versions.
- The tiny target could create a false sense that broad wrapper families are ready.

### 8. Mitigations

- Version-gate unsupported log commands explicitly.
- Keep rule-family matrix and policy labels clear about remaining local-only work.

### 9. Consequences of not implementing this PR

The repo would have readiness infrastructure but no end-to-end proof that the contracts compose.

### 10. Downsides for implementing this PR

It is the highest-integration readiness PR and may uncover gaps requiring plan updates.

## PR-19: Declared source snapshot generator and conformance assertion hardening

### 1. Intent

Close the remaining local/dry-run conformance gaps discovered after PR-18: prove the tiny
`remote:ready` runner actually executes, and remove the implicit source snapshot generator path so
Buck invokes that generator through declared tool inputs rather than a flake app, ambient PATH, or a
workspace-relative command string.

### 2. Scope of changes

- Update `build-tools/tools/tests/remote-exec/remote-conformance-target.test.ts` so the dry-run
  conformance test requires the runner's explicit `remote-ready-runner: ok` output instead of
  passing on generic Buck target/pass text.
- Update `build-tools/lang/source_snapshot.bzl` so the source snapshot action no longer shells
  through `nix run path:.#zx-wrapper`.
- Represent the source snapshot generator and its runtime/tool invocation as declared Buck inputs,
  without depending on ambient `node` from PATH or a workspace-relative script string as the
  executable authority.
- Keep source snapshot outputs unchanged: declared snapshot directory, manifest JSON, graph path
  evidence, and `SourceSnapshotInfo`.
- Preserve local/dry-run behavior and do not enable production remote execution.
- Keep the implementation inside existing Starlark/tool helper surfaces; do not add a scheduler,
  production RE lane, or ad hoc shell script with substantive logic.

### 3. External prerequisites

- None. Tests use local Buck analysis/execution and fixture targets only.

### 4. Tests to be added

- Update the tiny remote-ready conformance test to assert `remote-ready-runner: ok`.
- Add or update source snapshot action-command tests proving the action no longer renders
  `nix run path:.#zx-wrapper`.
- Add tests proving the generator tool/script is represented by declared Buck inputs and the command
  does not pass merely because `node` is available from ambient PATH.
- Rerun focused validation for source snapshot contracts, wrapper conformance, remote target policy,
  and the tiny remote-ready fixture.

### 5. Docs to be added or updated

- Update remote build setup docs if they describe source snapshot generator invocation details.
- Update `remote-build-integration-debt-ledger.md` with PR-19 focused validation evidence and the
  remaining full-suite checkpoint status.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are `build-tools/lang/source_snapshot.bzl`,
  `build-tools/tools/tests/remote-exec/**`, remote build docs, and the integration debt ledger.

### 6. Acceptance criteria

- The PR-18 conformance test fails unless the dry-run runner emits `remote-ready-runner: ok`.
- No source snapshot action renders `nix run path:.#zx-wrapper`.
- The source snapshot generator is represented by declared Buck inputs and does not rely on ambient
  PATH for its executable/tool authority.
- Existing source snapshot manifests and the tiny remote-ready conformance target still pass.

### 7. Risks

- Tool-path wiring could accidentally depend on developer PATH or unstated workspace layout.
- Over-tightening the conformance assertion could make unrelated Buck output formatting changes look
  like functional failures.

### 8. Mitigations

- Validate the generated command/provider surface directly and keep the tool path declared through
  existing Buck inputs.
- Assert only the runner-owned success line for execution proof, not incidental Buck progress text.

### 9. Consequences of not implementing this PR

The repo would have a nominal remote-ready conformance target, but one test could still pass without
proving the runner executed, and source snapshots would retain an implicit generator invocation path
that conflicts with the build-system generator guardrail.

### 10. Downsides for implementing this PR

It adds one more explicit tool input and tightens a test around intentionally narrow dry-run
conformance behavior.

## PR-20: Remote worker bootstrap zx helper

### 1. Intent

Keep the worker bootstrap/check flow aligned with the build-system script policy by moving its
substantive logic out of the flake's inline shell and into a repo-owned TypeScript zx helper while
preserving the local-only, scheduler-disabled behavior introduced for remote worker tool
conformance.

### 2. Scope of changes

- Add a `#!/usr/bin/env zx-wrapper` TypeScript helper for the remote worker bootstrap/check flow.
- Keep `apps.<system>.remote-worker-bootstrap` as a thin Nix launcher that provides the declared
  `remote-worker-tools` closure path and delegates to the helper.
- Preserve the current checks that print the worker tools store path, restrict `PATH` to the closure,
  verify required worker binaries, and report that scheduler registration is disabled.
- Do not add scheduler registration, production remote execution, mutable worker image setup, or
  provider-specific bootstrap behavior.
- Avoid adding substantive shell logic to the flake app or to a standalone `.sh` script.

### 3. External prerequisites

- None. Tests use local Nix app/package evaluation and fixture-only bootstrap checks.

### 4. Tests to be added

- Update remote worker bootstrap tests so `nix run .#remote-worker-bootstrap -- --check-only`
  continues to prove `PATH` is restricted to the declared `remote-worker-tools` closure.
- Add a static/script-policy test proving the remote worker bootstrap app is a thin launcher and the
  substantive logic lives in a `zx-wrapper` TypeScript helper.
- Keep the existing assertions that bootstrap does not attempt scheduler registration.

### 5. Docs to be added or updated

- Update `build-tools/docs/remote-build-setup.md` if it describes bootstrap implementation details.
- Update `remote-build-integration-debt-ledger.md` with PR-20 focused validation evidence and the
  remaining full-suite checkpoint status.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are `build-tools/tools/nix/flake/outputs-apps.nix`,
  `build-tools/tools/remote-exec/**`, `build-tools/tools/tests/nix/**`, remote build docs, and the
  integration debt ledger.

### 6. Acceptance criteria

- `apps.<system>.remote-worker-bootstrap` delegates to a `zx-wrapper` TypeScript helper rather than
  carrying substantive inline shell logic.
- The bootstrap check still reports the declared `remote-worker-tools` store path and closure-only
  `PATH`.
- Required worker binaries are still verified from the declared closure.
- Scheduler registration remains explicitly disabled.

### 7. Risks

- Nix app argument wiring could accidentally hide the declared closure path from tests.
- Moving the checks into TypeScript could weaken the existing closure-only `PATH` proof if the helper
  inherits developer environment state.

### 8. Mitigations

- Pass the worker tools path explicitly from the Nix app wrapper and validate it is a Nix store path
  before constructing `PATH`.
- Keep tests focused on the rendered app behavior and the helper's environment construction, not just
  on output text.

### 9. Consequences of not implementing this PR

The remote worker bootstrap flow would remain functionally local-only, but its substantive inline
shell implementation would conflict with the build-system design's automation-script policy.

### 10. Downsides for implementing this PR

It introduces one small helper file for a deliberately dormant bootstrap path, increasing surface area
without changing production remote execution behavior.

## PR-21: Source snapshot generator runtime closure

### 1. Intent

Close the remaining PR-19 assessment gap by making the source snapshot action's executable authority
fully declared. The action must not depend on the generator script's `#!/usr/bin/env zx-wrapper`
hashbang finding `zx-wrapper` on ambient `PATH`.

### 2. Scope of changes

- Update `build-tools/lang/source_snapshot.bzl` so the source snapshot action invokes the generator
  through a declared runtime/tool handle rather than executing `source-snapshot.ts` directly via its
  hashbang.
- Represent the generator script, zx wrapper/runtime, and supporting TypeScript runtime files as
  declared Buck inputs or tool outputs visible to the action command.
- Preserve the source snapshot output contract: declared snapshot directory, manifest JSON, graph
  path evidence, and `SourceSnapshotInfo`.
- Preserve local-only behavior for source snapshot generation and do not enable production remote
  execution.
- Do not reintroduce `nix run path:.#zx-wrapper`, ambient `node`, ambient `zx-wrapper`, or a
  workspace-relative command string as executable authority.

### 3. External prerequisites

- None. Tests use local Buck analysis/execution and fixture targets only.

### 4. Tests to be added

- Add or update source snapshot action-command tests proving the command does not execute
  `source-snapshot.ts` directly through its hashbang.
- Add tests proving the rendered command uses a declared runtime/tool handle for `zx-wrapper` or the
  equivalent declared Node/zx runtime and rejects ambient `PATH` executable authority.
- Rerun focused validation for source snapshot contracts, wrapper conformance, remote target policy,
  and the tiny remote-ready fixture.

### 5. Docs to be added or updated

- Update remote build setup docs if they describe source snapshot generator invocation details.
- Update `remote-build-integration-debt-ledger.md` with PR-21 focused validation evidence and the
  remaining full-suite checkpoint status.

### 5.5. Expected regression scope

- `build-system-only`
- Expected files are `build-tools/lang/source_snapshot.bzl`,
  `build-tools/tools/tests/remote-exec/**`, remote build docs, and the integration debt ledger.

### 6. Acceptance criteria

- The source snapshot action does not rely on `#!/usr/bin/env zx-wrapper` or ambient `PATH` to find
  the generator runtime.
- The generator script and its runtime/tool invocation are represented by declared Buck inputs or
  tool outputs.
- No source snapshot action renders `nix run path:.#zx-wrapper`, ambient `node`, ambient
  `zx-wrapper`, or a workspace-relative script string as executable authority.
- Existing source snapshot manifests and the tiny remote-ready conformance target still pass.

### 7. Risks

- Buck command construction could accidentally hide the runtime from action keys while appearing to
  work locally.
- Over-constraining command text assertions could make harmless Buck rendering changes look like
  functional failures.

### 8. Mitigations

- Assert the provider/command surface for declared tool inputs directly and keep behavioral tests
  focused on the source snapshot output contract.
- Match command text only for the forbidden ambient invocation forms and declared runtime evidence.

### 9. Consequences of not implementing this PR

Source snapshot generation would no longer use `nix run`, but it would still rely on ambient
`zx-wrapper` lookup through the generator hashbang, leaving the executable authority gap identified
by the end-of-range plan assessment.

### 10. Downsides for implementing this PR

It adds another explicit runtime/tool handle around a local-only generator action.
