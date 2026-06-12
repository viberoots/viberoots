# Remote Build/Test Readiness Design

Status: historical draft. Retained for design archaeology behind the remote-build readiness work;
use [`build-tools/docs/remote-build-setup.md`](../../../build-tools/docs/remote-build-setup.md) for current
operator/reference guidance.

Date reviewed: 2026-05-28

Primary input: `build-tools/docs/remote-build-setup.md`

Goal: make the repository ready for remote Nix builds and Buck2 remote build/test execution with minimal later configuration changes, without enabling remote execution or requiring remote credentials for normal local development today.

## Summary

The repository is close to being able to use remote Nix builders for selected Nix builds, but it is not close to safely running Buck test/build actions remotely. The main blockers are not cloud capacity. They are missing dormant Buck remote-execution configuration surfaces, missing remote-capable test-rule wiring, and many Buck actions/tests that still assume a local checkout and mutable workspace paths.

The design should land as inactive infrastructure:

- keep `.buckconfig` and developer defaults local-only;
- add opt-in Buck config generation and remote profile names that are inert unless explicitly included;
- make verify and CI able to pass remote options through their existing planners;
- make repo-owned test wrappers accept and propagate Prelude remote-execution attributes, while defaulting to `None`;
- audit and mark rule families as `local_only` until their declared-input and workspace assumptions are fixed;
- add Nix worker-tool, CI service-client, and cache-publish interfaces that can be built locally and pushed to a cache, but do not configure any production cache or builder by default.

Remote execution should become a configuration flip only after conformance proves representative targets execute remotely from declared inputs.

## Documentation Checked

Online assumptions were checked against current upstream docs:

- Buck2 remote execution docs: Buck2 uses REAPI services and reads endpoint/auth settings from `[buck2_re_client]`; projects also need execution platforms whose `CommandExecutorConfig` has `remote_enabled = True`. Source: https://buck2.build/docs/users/remote_execution/
- Buck2 test execution docs: remote-compatible tests need `ExternalRunnerTestInfo` executor fields, and `run_from_project_root` / `use_project_relative_paths` must be true for compatible RE execution. Source: https://buck2.build/docs/rule_authors/test_execution/
- Buck2 configuration docs: build actions use `build.execution_platforms` and `ExecutionPlatformRegistrationInfo`; target platforms alone do not select a remote executor. Source: https://buck2.build/docs/rule_authors/configurations/
- Nix distributed build docs: remote builders require SSH reachability, trusted users, daemon-user SSH access in multi-user installs, and can be configured through `builders = @/etc/nix/machines`. Source: https://nix.dev/manual/nix/2.30/advanced-topics/distributed-builds.html
- Nix config docs: `builders-use-substitutes = true` makes remote builders fetch dependencies from their own substituters, and `max-jobs = 0` disables local builds. Source: https://nix.dev/manual/nix/stable/command-ref/conf-file

Local Prelude review also confirmed:

- `prelude/tests/re_utils.bzl` exposes `get_re_executors_from_props(ctx)`.
- `prelude/toolchains/remote_test_execution.bzl` supports named profiles, `default_profile`, and `default_run_as_bundle`.
- `prelude/sh_test.bzl` is the reference implementation for passing `default_executor`, `executor_overrides`, `run_from_project_root`, and `use_project_relative_paths` into `ExternalRunnerTestInfo`.

## Current Repository Findings

### Buck2 Defaults Are Local-Only

`.buckconfig` has only the default Prelude platform:

```ini
[build]
prelude = prelude
user_platform = prelude//platforms:default
target_platforms = prelude//platforms:default
```

There is no `[buck2_re_client]` section and no `build.execution_platforms` target that can select a remote executor. `toolchains/TARGETS` declares `toolchains//:remote_test_execution`, but it has no profiles and therefore cannot select meaningful worker classes.

This is good for the "do not enable yet" constraint, but it means a future enablement cannot be just adding credentials. The repo needs inactive config-generation and platform/profile targets first.

### CI Bypasses The Full Verify Planner

`Jenkinsfile` runs `node build-tools/tools/ci/run-stage.ts --stage buck-test`.

That stage currently resolves requested scope, then calls:

```ts
buck2 test ${selection.targets} ${extra}
```

It does not call the full `v`/verify flow. It bypasses startup checks, seed setup, pass partitioning, nested isolation registration, richer logging, resource summaries, and coverage aggregation semantics described in `remote-build-setup.md`.

Remote test execution should be wired through the verify pass planner, not through an independent direct `buck2 test` path.

### Verify Has The Right Shape But No Remote Fields

`build-tools/tools/dev/verify/target-passes.ts` already partitions targets by labels:

- `verify:isolated` gets a serial pass with `threadsOverride = 1`;
- `verify:resource-limited` gets a serial pass with `threadsOverride = 4`;
- shared tests go in the shared pass.

`build-tools/tools/dev/verify/buck2-test.ts` already centralizes the Buck invocation. That is the right point to apply optional remote config files, execution platforms, event log paths, build reports, and pass-to-profile mapping.

What is missing is an explicit execution policy on each `VerifyTargetPass`.

### Repo-Owned External Runner Tests Do Not Propagate RE Executors

The following wrappers return `ExternalRunnerTestInfo` but do not call `get_re_executors_from_props(ctx)`:

- `build-tools/tools/buck/zx_test.bzl`
- `build-tools/node/private/nix_test.bzl`
- `build-tools/go/private/nix_test.bzl`
- `build-tools/python/private/nix_test.bzl`
- `build-tools/cpp/private/nix_test.bzl`

They also do not explicitly set `run_from_project_root = True` and `use_project_relative_paths = True`.

Adding executor propagation alone is not enough. The wrappers currently read and mutate workspace paths such as `WORKSPACE_ROOT`, `buck-out`, `.buckconfig`, `prelude`, `node_modules`, and generated graph files. They should remain `local_only` until those inputs are either declared or replaced with explicit source snapshots and declared outputs.

The wrappers also need command-input cleanup before they can be remote-ready. Several test providers pass plain string commands such as `["bash", "-c", run_cmd]` and refer to files through `script.short_path` or `$WORKSPACE_ROOT`. Hidden inputs on a separate stamp action do not make those files available to the external test runner command. Remote-compatible commands must carry scripts, snapshots, manifests, and helper artifacts through `cmd_args`, `RunInfo`, or other Buck handles that the test runner can hand back to Buck for execution.

### Buck Build Actions Have Local Workspace Assumptions

Several build rules use `ctx.actions.run` around shell fragments that invoke Nix and read `$WORKSPACE_ROOT`:

- `build-tools/go/private/nix_build*.bzl`
- `build-tools/python/private/nix_build.bzl`
- `build-tools/cpp/private/nix_build.bzl`
- `build-tools/rust/private/nix_build.bzl`
- Node build/stage wrappers in `build-tools/node/*.bzl`
- shared helpers in `build-tools/lang/nix_shell.bzl` and `build-tools/lang/nix_action_runner.bzl`

These actions should be treated as local-only until a declared source snapshot and graph input model exists. Otherwise a remote worker would need an ambient checkout, which defeats Buck's CAS input model.

### Nix Selected Builds Are Mostly Remote-Builder Compatible

`build-tools/tools/dev/build-selected.ts` scrubs dev override envs and calls Nix through `runNixBuildWithTransientRetry`. It now includes `--print-out-paths`, but the setup doc correctly notes selected-target calls still omit `--no-link`.

The verify seed path in `build-tools/tools/dev/verify/seed.ts` intentionally uses `--out-link` to pin `.#test-seed` under `buck-out/tmp/verify-seed/nix-root`. That is acceptable for local verify ergonomics, but it must not be used inside remote Buck actions. Remote mode needs either `--no-link` plus explicit per-run pinning outside the action sandbox, or a declared seed/source artifact.

### `.envrc` Masks Remote Builders By Default

`.envrc` injects:

```sh
builders =
build-hook =
max-jobs = auto
```

unless `NIX_CONFIG` already contains `builders =`. This preserves local behavior but means remote-builder smoke tests and CI must set `NIX_CONFIG` before entering the repo. No code change should silently enable builders for developers, but the repo should add a smoke/config helper that makes the effective config visible.

### Nix Cache Push Exists Only For Wheelhouses

`run-stage.ts --stage wheelhouse-preload` can push `py-wheelhouse-*` outputs with `NIX_CACHE_TO` / `--to`. There is no generic cache publisher for:

- `.#graph-generator`;
- `.#buck2-prelude`;
- `.#test-seed`;
- worker-tool closures;
- exact flake archive inputs;
- selected graph-materialization outputs.

Remote readiness needs a generic manifest-driven publisher, not production cache credentials.

### No Worker Tool Closure Exists

`build-tools/tools/nix/flake/packages/default.nix` exports packages such as `buck2-prelude`, `zx-wrapper`, `test-seed`, `toolchains`, node outputs, and deployment images. It does not export `remote-worker-tools`.

Worker images should install only host-level prerequisites. Repo tools should come from a pinned Nix closure. This is a code change we can make before any production worker exists.

The same applies to CI and operator-side helper tools. Cache publishers, artifact uploaders, metrics/log wrappers, RE backend clients, and provider CLIs used by this design should come from a declared Nix closure rather than whatever happens to be installed on the CI image.

## Design Principles

1. Defaults stay local-only.
2. Configuration is explicit and file-backed.
3. Buck remains the build/test scheduler; repo code does not implement an action scheduler.
4. Nix remains the store/build/cache layer; repo code does not implement a Nix substituter or builder.
5. Remote-capable is opt-in per rule family and validated by evidence.
6. Rule families with undeclared checkout reads stay `local_only`.
7. Remote execution config is generated or included in CI, never committed with secrets.
8. Remote test/build verification uses Buck event logs and reports as the source of truth.
9. External tool/runtime dependencies are Nix-provided. Remote-ready actions, tests, workers, and CI helpers must not rely on developer PATH, mutable worker images, package-manager installs, or host-installed language toolchains. The only acceptable non-Nix prerequisites are machine primitives that cannot sensibly be Nix store paths: kernel/sandbox support, disks, network reachability, mounted credentials or workload-identity material, certificates/trust anchors, clocks, and the minimal Nix installation needed to realize the declared closures. If repo code invokes an executable for SSH, workload identity, artifact upload, metrics/logging, provider access, cache publishing, or worker registration, that executable is not a primitive and must come from a declared Nix output.

## Proposed Code Changes

### 0. Add Explicit Non-Enablement Guardrails

Before adding any remote-capable surfaces, add tests that prove the default repo still cannot accidentally use remote execution.

Add a small guard test, for example:

- `build-tools/tools/tests/remote-exec/defaults-local-only.test.ts`

Checks:

- root `.buckconfig` has no `[buck2_re_client]`;
- root `.buckconfig` does not set `build.execution_platforms` to a remote registration target;
- `toolchains//:remote_test_execution` has no selected `default_profile`;
- no committed generated config contains real endpoint hostnames, tokens, signing keys, SSH key paths, or cache credentials;
- no Jenkins stage sets remote mode env vars by default.

Acceptance:

- The guard test fails if a future change turns remote execution on by default.
- The test allows inert profile/platform targets and generated-config templates.

Local-only invariants:

- Committed Buck config remains local by default: no `[buck2_re_client]` section and no
  `build.execution_platforms` remote registration.
- `toolchains//:remote_test_execution` may model dormant profiles, but the committed target must not
  select `default_profile`.
- Jenkins and CI defaults do not set `VBR_REMOTE_EXEC_MODE`, `VBR_REMOTE_BUCK_CONFIG`,
  `VBR_REMOTE_EXEC_SYSTEM`, or `VBR_REMOTE_ARTIFACT_DIR`.
- Direct `buck2 test //...` and CI smoke-test entrypoints stay on committed local config unless a
  later policy explicitly passes a generated remote config.
- Config templates and examples use fake endpoints and environment/file references only; real
  endpoints, tokens, signing keys, SSH key paths, cache credentials, and inline PEM material are
  rejected by the checker.

### 1. Add Dormant Remote Execution Configuration Surfaces

Add a new small Starlark module, for example:

- `toolchains/remote_execution_platforms.bzl`
- `toolchains/remote_execution_profiles.bzl`

Add inactive targets in `toolchains/TARGETS`:

- `toolchains//:remote_test_execution` with named profile keys but no default profile;
- `toolchains//:remote_execution_platforms` returning `ExecutionPlatformRegistrationInfo`;
- local-only fallback execution platform preserving current behavior.

The execution platform implementation must not depend on production infrastructure to analyze. It should use checked-in constraint/configuration targets for the supported systems and construct `ExecutionPlatformInfo` values with `CommandExecutorConfig` values that are remote-capable only when the generated config selects that registration target. The local fallback platform should keep `local_enabled = True` and `remote_enabled = False`; remote platforms should use explicit `local_enabled` and `use_limited_hybrid` values derived from the selected lane policy, not hidden defaults.

The profile names should match `remote-build-setup.md`:

- `linux-x86_64-default`
- `linux-x86_64-large`
- `linux-aarch64-default`
- `linux-aarch64-large`
- `darwin-aarch64-default`

Each profile value must use the exact Prelude `re_test_common.opts_for_tests_arg()` shape consumed by `prelude/tests/re_utils.bzl`. Allowed keys are:

- `capabilities`;
- `listing_capabilities`;
- `local_listing_enabled`;
- `local_enabled`;
- `use_case`;
- `remote_cache_enabled`;
- `dependencies`;
- `resource_units`;
- `remote_execution_dynamic_image`.

Each named profile must include `capabilities` and `use_case`, because `get_re_executors_from_props(ctx)` unconditionally pops those keys before creating the `CommandExecutorConfig`. The schema test should validate both type shape and required-key presence.

Do not add repo-only keys such as `platform`, `worker_image`, or `fallback_policy` inside the test profile map. Those concepts must be represented either as supported Prelude keys, generated Buck config, or build execution platform fields. Add a Starlark analysis test that fails on unknown profile keys so `get_re_executors_from_props(ctx)` cannot later fail during remote analysis.

These profiles should not be selected by default. `default_profile` remains `None`. Set `default_run_as_bundle = False` explicitly so future default-profile experiments do not accidentally change verify bundling semantics.

The build execution platform target should include remote executor definitions, but only be used from an opt-in `.buckconfig` include. Developer `.buckconfig` should stay unchanged except for a documented optional include path if Buck supports it cleanly in this repo.

Acceptance:

- `buck2 cquery toolchains//:remote_test_execution` still works locally without credentials.
- `buck2 audit execution-platform-resolution` for ordinary local targets remains unchanged unless an opt-in config file is passed.
- a local analysis of `toolchains//:remote_execution_platforms` succeeds without contacting an RE endpoint.
- No remote profile is selected by default.
- Profile schema tests prove each named profile can be converted by `get_re_executors_from_props(ctx)` without unexpected-key failures.

### 2. Add A Generated CI/Developer Remote Buck Config

Add a TypeScript helper:

- `build-tools/tools/remote-exec/render-buckconfig.ts`

Inputs:

- endpoint addresses;
- instance name;
- auth mode: mTLS files or HTTP headers provided through environment references;
- target system/profile;
- fallback policy: strict-remote, hybrid, or local-only;
- event log/report output directory.

Output:

- a generated `.buckconfig.remote.generated` under `buck-out/tmp/remote-exec/<run-id>/`;
- never writes secrets into the repo root;
- uses only config keys verified against the pinned Buck2 version.

The generated file may contain:

```ini
[buck2_re_client]
engine_address = grpc://...
cas_address = grpc://...
action_cache_address = grpc://...
instance_name = ...
tls_ca_certs = ...
tls_client_cert = ...
http_headers = ...

[build]
execution_platforms = toolchains//:remote_execution_platforms
```

The helper should validate that mTLS secrets are paths to files, not inline PEM values. For header authentication, the generated Buck config should contain only environment-variable references or non-secret header names, not bearer tokens or API keys. Buck's documented `http_headers` key is a header list, not a path-to-file field, so the renderer must reject inline token-like values and log only redacted header names plus a config fingerprint.

Acceptance:

- Unit tests verify rendering for mTLS and header-auth modes.
- Tests assert token-like values are rejected or redacted, including accidental inline `http_headers` secrets.
- The helper is not invoked by default CI yet.

### 3. Extend Verify Passes With Execution Policy

Add parsing for remote execution options in `build-tools/tools/dev/verify/args.ts` and pass the resulting policy through `runVerify`, `runVerifyBuckPasses`, and `spawnVerifyBuck2Tests`.

The supported inputs should be intentionally boring:

- `VBR_REMOTE_EXEC_MODE=local|hybrid|remote|remote-only-conformance`;
- `VBR_REMOTE_BUCK_CONFIG=<path>`;
- `VBR_REMOTE_EXEC_SYSTEM=x86_64-linux|aarch64-linux|aarch64-darwin`;
- `VBR_REMOTE_ARTIFACT_DIR=<path>`;
- optional `VBR_REMOTE_TEST_PROFILE_<PASS_NAME>=<profile>` overrides.

Default mode is always `local`.

Remote policy must also carry the target platform and cquery configuration used for target expansion. `loadVerifyTargetLabels()` currently hardcodes `--target-platforms prelude//platforms:default`; remote mode should either keep that local target platform intentionally or pass the same target-platform selection used by the remote Buck invocation. The target label plan, policy check, and final Buck invocation must agree on the same configured targets.

Extend `VerifyTargetPass` in `build-tools/tools/dev/verify/target-passes.ts`:

```ts
type VerifyExecutionPolicy = {
  mode: "local" | "remote" | "hybrid" | "remote-only-conformance";
  testProfile?: string;
  buildExecutionPlatformsConfig?: string;
  buckConfigFile?: string;
  allowCompatibleTestsOnRe?: boolean;
  preferRemote?: boolean;
  remoteOnly?: boolean;
  eventLog?: string;
  buildReport?: string;
  commandReport?: string;
  buildIdFile?: string;
  testExecutorStdout?: string;
  testExecutorStderr?: string;
  materializeFailedInputs?: boolean;
  materializeFailedOutputs?: boolean;
};
```

Default policy is `mode: "local"`.

Parse and validate the remote execution policy before local verify side effects. In `runVerify`, remote-mode validation should happen before housekeeping, local coverage setup, verify seed preparation, Buck daemon/watchdog startup, prewarm, and local tool-path computation. A rejected remote request should fail without creating local coverage directories, local seed pins, local prewarm outputs, daemon state, or other host-local artifacts that would not be meaningful to remote execution.

For accepted remote requests, split verify setup into explicit local and remote-safe branches. Local mode can keep current housekeeping, prewarm, seed, and `computeZxTestNodeModulesOut` behavior. Remote mode should either skip local-only preparation or replace it with declared source snapshots, cache/materialization manifests, and worker-tool closure references that the remote env builder can allowlist.

Map pass names to dormant profile names only when remote mode is explicitly requested. `VBR_REMOTE_EXEC_SYSTEM` uses Nix system strings, so verify must translate them to the profile prefix vocabulary before appending the resource class:

- `x86_64-linux` -> `linux-x86_64`
- `aarch64-linux` -> `linux-aarch64`
- `aarch64-darwin` -> `darwin-aarch64`

Pass mapping:

- shared: `<profile-prefix>-default`
- isolated: `<profile-prefix>-default` or a dedicated isolated profile if later added
- resource-limited: `<profile-prefix>-large`

Keep `threadsOverride` independent from remote resource class. `verify:isolated` still means serial pass semantics; `verify:resource-limited` still means the existing 4-thread cap unless changed intentionally.

Acceptance:

- Existing `v` output and local pass planning are unchanged.
- Tests cover local default and remote policy mapping without requiring a live RE backend.
- Remote policy parsing rejects missing generated config paths, relative secret paths, unknown systems, unknown modes, and attempts to request remote coverage before the coverage artifact contract is implemented.
- Remote policy rejection occurs before local housekeeping, seed, coverage, daemon/watchdog, prewarm, or tool-path setup.
- Remote-mode verify setup does not compute or forward local `zx`/`node_modules` tool paths unless they are represented by the worker-tool closure or another declared artifact.
- Tests assert every supported `VBR_REMOTE_EXEC_SYSTEM` maps to an existing profile name and cannot produce Nix-style profile names such as `x86_64-linux-default`.
- cquery target expansion and the final Buck test invocation use the same target-platform/config policy in remote mode.

### 3a. Add An Explicit Remote Test Profile Activation Mechanism

The verify pass policy cannot stop at selecting profile names. Prelude only produces remote test executors when either:

- the analyzed test target has `remote_execution = "<profile>"`; or
- the resolved remote test execution toolchain has a non-`None` `default_profile`.

Current repo-owned targets do not set `remote_execution`, and `toolchains//:remote_test_execution` has no `default_profile`. Therefore, a verify-side pass-to-profile map would be inert unless the profile selection is connected to Buck analysis.

Add one dormant activation mechanism and test it before claiming remote-test readiness:

- preferred: expose `remote_execution` through repo-owned test macros and add an explicit generated/remote-only target selection layer that sets `remote_execution = "<profile>"` only for conformance targets selected in remote mode;
- acceptable: add alternate remote test execution toolchain targets with `default_profile` set per worker class, and make generated remote config select those alternates without changing committed local defaults;
- unacceptable: set `default_profile` on the committed default `toolchains//:remote_test_execution`, because that would make profile selection implicit for every compatible test once a client config exists.

Whichever path is chosen, the verify planner must fail remote mode if it maps a pass to a profile but no activation mechanism is selected. This keeps `VBR_REMOTE_TEST_PROFILE_*` from becoming a log-only setting.

Acceptance:

- Local analysis still resolves `toolchains//:remote_test_execution` with `default_profile = None`.
- A focused provider/cquery test proves that the selected activation path makes `get_re_executors_from_props(ctx)` return executor fields for a target using `linux-x86_64-default`.
- Remote mode fails before invoking Buck if the requested pass profile is not connected to either target `remote_execution` attrs or an explicitly selected alternate toolchain.
- Generated activation files or configs contain only profile names and toolchain labels, not RE endpoints or credentials.

### 4. Centralize Buck Remote Invocation In `spawnVerifyBuck2Tests`

Update `build-tools/tools/dev/verify/buck2-test.ts` to accept the pass execution policy.

When `mode = local`, emit the same command as today.

When remote is explicitly requested, add only verified flags:

- `--config-file <generated-config>`
- `--prefer-remote` for hybrid/prefer remote lanes;
- `--remote-only` only for conformance lanes;
- `--unstable-allow-compatible-tests-on-re`, not `--unstable-allow-all-tests-on-re`;
- `--event-log <path>.pb.zst`;
- `--build-report <path>.json`;
- `--write-build-id <path>.txt`;
- `--command-report-path <path>.json`.

Also add dormant artifact/debug controls supported by the pinned Buck2 `test` command:

- `--test-executor-stdout <path>.log`;
- `--test-executor-stderr <path>.log`;
- optional `--materialize-failed-inputs` and `--materialize-failed-outputs` for remote conformance diagnostics.

Keep failed-input/output materialization disabled by default because it can be large and can materialize sensitive action data onto the CI host. When enabled for a conformance lane, the artifact contract must record the reason, target/pass, retention class, and redaction policy.

The current verify Buck invocation suppresses Buck file tailers and event-log writer output through `RUST_LOG` / `BUCK_LOG`. Remote mode must treat the explicit `--event-log` path as a required artifact and must not suppress it through inherited logging environment. Either remove the `buck2_event_log::writer=off` override for remote invocations or add an argv/env regression test proving the requested event log is still written.

Do not add remote flags directly in `run-stage.ts`. CI should call verify with an explicit remote policy and let this function build the command.

Acceptance:

- Snapshot/unit tests assert exact local argv is unchanged.
- Snapshot/unit tests assert exact remote argv for each mode.
- Event-log and report paths are under an artifact directory, not repo root.
- Optional test-executor stdout/stderr and failed-input/output materialization paths are under the artifact directory and are off by default.
- Remote argv/env tests prove requested event logs and reports are not suppressed by verify's logging environment.
- Remote mode records the selected config fingerprint and profile in the verify log without logging secret values.

### 5. Replace `run-stage.ts --stage buck-test` With Verify Planner Execution

Change `build-tools/tools/ci/run-stage.ts` so the `buck-test` stage delegates to the same verify orchestration used by `v`, or extracts the shared verify runner into a callable library.

Requirements:

- preserve `resolveRequestedVerifyScope`;
- preserve coverage env passthrough;
- preserve CI timeout behavior;
- use `resolveVerifyTargetPlan`;
- call `runVerifyTargetPasses` / `spawnVerifyBuck2Tests` rather than raw `buck2 test`;
- allow future `VBR_REMOTE_EXEC_MODE=remote|hybrid|local` and generated config paths.

This can land while defaulting to local mode.

Also classify every non-verify CI Buck invocation. Today `build-tools/tools/ci/cpp-addon-smoke.ts` scaffolds a temporary project and runs `buck2 test //projects/libs/demo:unit` directly. That path should either remain explicitly local-only, with remote env vars scrubbed before the direct Buck invocation, or be converted to call the same verify runner once the temporary workspace can provide the required remote policy inputs. A future Jenkins remote lane must not set broad remote env vars at a scope where direct smoke stages inherit them unintentionally.

Acceptance:

- CI local behavior remains equivalent.
- Existing tests for scope selection keep passing.
- New tests assert `buck-test` no longer bypasses verify pass planning.
- Static tests list direct `buck2 test` CI call sites and require each one to be either routed through verify or explicitly local-only.
- `Jenkinsfile` remains local-only by default; any future remote lane must pass remote env/config explicitly.

### 6. Wire Remote Executor Fields Through Repo-Owned Test Wrappers

For each repo-owned external runner test wrapper:

- load `get_re_executors_from_props` from `@prelude//tests:re_utils.bzl`;
- add the exact standard remote test attrs from `@prelude//decls:re_test_common.bzl` via `re_test_common.test_args()` if the rule does not already inherit them. This includes `remote_execution`, `remote_execution_action_key_providers`, and `_remote_test_execution_toolchain`;
- call `re_executor, executor_overrides = get_re_executors_from_props(ctx)`;
- pass these into `ExternalRunnerTestInfo`;
- explicitly set `run_from_project_root = True`;
- explicitly set `use_project_relative_paths = True`.

Affected files:

- `build-tools/tools/buck/zx_test.bzl`
- `build-tools/node/private/nix_test.bzl`
- `build-tools/go/private/nix_test.bzl`
- `build-tools/python/private/nix_test.bzl`
- `build-tools/cpp/private/nix_test.bzl`

Important: leave all macro callsites defaulting to `remote_execution = None`. Do not assign profile strings automatically until the wrapper family passes hermeticity tests.

Acceptance:

- `buck2 cquery --output-attribute remote_execution` can see the attr where applicable.
- Local tests still run locally without remote config.
- A focused Starlark or cquery test verifies that setting `remote_execution = "linux-x86_64-default"` produces provider executor fields.

### 6a. Make External Runner Commands Carry Declared Inputs

Before any repo-owned external runner can be marked `remote:ready`, rewrite its `ExternalRunnerTestInfo.command` and `env` values so Buck can materialize every required file for the test execution request.

Required changes:

- replace plain string references to `script.short_path`, helper script paths, graph files, source roots, and generated manifests with `cmd_args` or `RunInfo` handles;
- move hidden dependencies from unrelated stamp actions onto the actual test command handle;
- use declared source snapshots or declared manifests instead of `$WORKSPACE_ROOT` lookups;
- ensure helper launchers, shell scripts, interpreters, CLIs, and language runtimes used by the test are execution deps or worker-tool closure entries, not ambient PATH assumptions;
- keep local convenience bootstrap paths available only under local mode.

Affected examples:

- `zx_test.bzl` should pass `ctx.attrs.script`, `template_inputs`, and helper scripts through the command handle instead of relying on `script.short_path` under `$WORKSPACE_ROOT`;
- `node_nix_test`, `go_nix_test`, `python_nix_test`, and `cpp_nix_test` should attach their Nix inputs, source snapshot, graph manifest, and selected-output manifest to the command that the test runner executes, not only to a stamp action.

Acceptance:

- a provider/cquery test can inspect remote-ready wrappers and confirm their external-runner command contains non-verbatim artifact handles for required files;
- remote policy rejects any `remote:ready` wrapper whose command is a plain workspace-path shell string without declared handles;
- local execution remains unchanged for wrappers that are still `remote:local-only`.

### 7. Add Remote-Safe Test Environment Handling

`build-tools/tools/dev/verify/buck2-test-env.ts` currently forwards many local paths and mutable run-control values into Buck tests, including seed pin directories, local tool paths, Nix daemon socket path, shared prelude path, log paths, coverage paths, and nested Buck isolation values. That is correct for local verify, but remote mode needs a narrower environment contract.

Add a remote-aware env builder:

- local mode: current behavior;
- remote mode: allowlist only values that are meaningful inside a remote action sandbox;
- reject host absolute paths unless they are declared artifacts, Nix store paths from a declared closure/materialization manifest, or remote-safe config files;
- do not forward Nix daemon sockets, repo-root `buck-out` paths, local seed pin dirs, local `NODE_V8_COVERAGE`, or developer override envs;
- pass cache and worker config by declared file path or generated config reference, not broad ambient env.

Remote tests that need seed/source material should receive a declared source snapshot or exact cache/materialization manifest, not `VBR_TEST_SEED_PIN_DIR`.

The remote env builder must also account for Nix's impure-evaluation allowlist. Root `flake.nix` and `build-tools/tools/nix/flake/nix-config.nix` currently allow multiple environment-driven inputs, not only `WORKSPACE_ROOT`. Remote mode should maintain a reviewed Nix eval env allowlist and reject undeclared values for keys such as dev override JSON, planner tracing/selection flags, pnpm generation flags, coverage toggles, test partial-clone flags, exact store paths, and graph paths unless the value is represented by a declared source snapshot, graph artifact, materialization manifest, or per-target remote policy field.

Acceptance:

- Local env argv snapshot remains unchanged.
- Remote env argv snapshot contains no repo-root `buck-out`, `.direnv`, `node_modules`, `/tmp` seed-stage path, Nix daemon socket, or local coverage directory.
- Dev override envs are scrubbed for both local CI and remote mode.
- Static tests compare the Nix impure-env allowlists against the remote env builder so new environment-driven Nix inputs are either declared remote-safe or rejected before remote mode can run.

### 8. Add Remote Readiness Policy Metadata

Add a Buck-visible metadata surface for remote status:

- `remote:local-only`: the target/action is allowed only on the invoking host. This is the
  default for repo-owned Nix-backed wrappers and actions.
- `remote:ready`: the target has declared command inputs, project-relative execution flags, source
  snapshot evidence, materialization, artifact, builder-policy, smoke, and profile compatibility
  evidence.
- `remote:needs-source-snapshot`: the target cannot graduate until workspace reads are replaced by a
  declared project-relative source snapshot.
- `remote:external-readonly`: the target reads external state and needs reviewed remote egress and
  credential boundaries before remote-only conformance.
- `remote:external-mutating-locked`: the target mutates external state and additionally needs a
  lock/fencing capability before remote mode can select it.

Use labels initially because the verify planner already reads labels. Later this can become a stricter rule attr if needed. In remote mode, absence of `remote:ready` is treated as local-only and rejected before Buck test execution.

Default every repo-owned Nix-backed test/build wrapper to local-only by policy. Do not trust absence of a label as ready.

Fix wrapper label propagation at the same time. Some repo-owned wrappers have a `labels` attr but currently do not pass it through to `ExternalRunnerTestInfo`:

- `build-tools/go/private/nix_test.bzl`
- `build-tools/python/private/nix_test.bzl`
- `build-tools/cpp/private/nix_test.bzl`

Those providers should use the same readiness-label helper as cquery-visible macro labels so
test-runner metadata, verify cquery metadata, policy checks, and event-log summaries agree. Wrapper
macros should add `remote:local-only` by default until their family is explicitly converted.

For repo-owned Nix-backed build actions, labels alone are not enough. Once an opt-in remote execution platform is selected, ordinary `ctx.actions.run` actions can be scheduled remotely unless the action itself is constrained. Add a shared Starlark helper for Nix-backed actions, for example:

- `build-tools/lang/remote_action_policy.bzl`

The helper should make the default explicit:

- local-only action: pass `local_only = True` to `ctx.actions.run` and stamp policy metadata for static checks;
- local-only genrule wrappers: stamp `remote:local-only` and the Prelude local-scheduling label used by genrule to set `local_only = True`;
- remote-ready action: require declared source snapshot, materialization manifest, artifact contract, builder policy, and remote profile compatibility before allowing `local_only = False`;
- hybrid action: require the same remote-ready evidence plus an explicit fallback reason.

Update repo-owned Nix-backed build rules to call this helper before any remote execution platform can be used:

- `build-tools/go/private/nix_build*.bzl`
- `build-tools/python/private/nix_build.bzl`
- `build-tools/cpp/private/nix_build.bzl`
- `build-tools/rust/private/nix_build.bzl`
- Node build/stage wrappers in `build-tools/node/*.bzl`
- shared Nix action helpers in `build-tools/lang/nix_action_runner.bzl` and `build-tools/lang/nix_shell.bzl`

Add a policy check:

- `build-tools/tools/dev/remote-exec-policy-check.ts`

Checks:

- remote mode cannot select targets labeled `remote:local-only` or targets missing explicit `remote:ready`;
- external mutating tests require a lock capability before remote mode;
- remote-ready targets must also have provider evidence for `run_from_project_root` and `use_project_relative_paths` true;
- resource labels map to a valid profile.
- remote-ready tests must not require Buck local resources unless the selected lane is explicitly hybrid/local-fallback and the local resource requirement is reported;
- remote-ready tests that request provider-level network access must name an explicit reviewed remote egress capability, credential boundary, and lock/idempotency policy where applicable;
- remote-ready external-runner tests must have declared command inputs and no required plain `$WORKSPACE_ROOT` lookups.

Buck test providers can also carry `local_resources` / `required_local_resources` for resources that only exist on the invoking host. Add provider/cquery coverage for these fields. A target with required local resources must stay `remote:local-only` until that dependency is either removed, represented by a remote worker capability, or handled through an explicit hybrid fallback policy. Do not rely on RE to supply local-resource semantics implicitly.

Buck test providers can also expose `network_access`. The policy checker must inspect provider/cquery output for it. Tests needing network stay `remote:local-only`, `remote:external-readonly`, or `remote:external-mutating-locked` until the design names the remote egress class, credentials, locks/idempotency where relevant, and worker-network capability. Remote mode must not infer network permission from the worker's ambient egress.

Provider fields that block remote-only conformance are: `local_resources`,
`required_local_resources`, `network_access`, missing `run_from_project_root`, missing
`use_project_relative_paths`, undeclared command inputs, and plain required `$WORKSPACE_ROOT`
lookups. A remote-ready wrapper must model each of those as a remote worker capability, egress/lock
policy, declared input handle, or source snapshot before the policy checker can allow it.

Acceptance:

- Local verify ignores the check or runs it as informational.
- Remote opt-in fails before Buck invocation if target policy is incompatible.
- Provider/cquery tests prove repo-owned wrappers preserve explicit labels and receive default `remote:local-only` metadata.
- Provider/cquery tests prove remote policy sees `local_resources` / `required_local_resources` and rejects them for remote-only conformance.
- Provider/cquery tests prove remote policy sees `network_access` and rejects unreviewed network tests for remote-only conformance.
- Static Starlark/text tests prove repo-owned Nix-backed `ctx.actions.run` call sites either pass `local_only = True` by default or go through the shared remote action policy helper.
- Remote conformance cannot select a target whose transitive Nix-backed build actions are still local-only unless the lane is explicitly hybrid and the fallback is reported.

### 9. Fix Nix `--no-link` Drift Where Remote-Relevant

Update selected-target build paths that may run under remote-capable actions to use `--no-link`.

Immediate candidates:

- `build-tools/tools/dev/build-selected.ts` should include `--no-link` in both trace and non-trace `nix build` calls.

Keep `build-tools/tools/dev/verify/seed.ts` local behavior as-is for now, but split the seed builder into two modes:

- local mode: current `--out-link` pinning under `buck-out/tmp/verify-seed`;
- remote-ready mode: `--no-link --print-out-paths` and explicit artifact/cache manifest output.

Remote Buck actions must not create workspace out-links or rely on repo-root GC roots.

Acceptance:

- Selected builds still print a single store path.
- Tests assert selected build argv includes `--no-link`.
- Verify seed local behavior is unchanged.

### 9a. Classify Nix Builder Policy At Call Sites

Several repo paths intentionally pass `--builders ""` today so local/test builds do not escape to configured Nix builders. That behavior is valid for developer bootstrap, temp-workspace tests, scaffolding checks, and paths that mutate or inspect a local checkout. It is not valid for remote-capable build/test flows, where the caller must be able to inherit configured remote builders or rely on pre-populated substituters.

Add a small shared Nix builder policy surface, for example:

- `build-tools/tools/lib/nix-builder-policy.ts` for TypeScript tools;
- a matching Starlark helper or enum constant for Buck rule fragments that render Nix commands.

Policy values:

- `local_only`: append `--builders ""` and document the local-only reason;
- `inherit_config`: do not pass `--builders`, allowing `NIX_CONFIG`, daemon config, or CI config to decide;
- `force_builders_file`: pass only an explicit generated builders file or generated `NIX_CONFIG` value provided by CI/smoke tooling.

Update known call sites to declare one of these policies rather than embedding `--builders ""` ad hoc. Known local-only examples include `build-tools/tools/dev/node-modules-build.ts`, `build-tools/tools/buck/node-cli-bundle.ts`, update-pnpm-hash/store-refresh helpers, and temp-workspace/scaffolding tests. Remote-ready paths must use `inherit_config` or `force_builders_file` and must pass the remote builder smoke check before being labeled `remote:ready`.

Acceptance:

- Static tests find no unclassified production `--builders ""` usage outside tests or explicitly local-only helpers.
- Remote policy rejects `remote:ready` wrappers/actions that render `--builders ""`.
- Local bootstrap and temp-workspace tests retain their current local-only Nix behavior.
- The remote builder smoke tool reports whether a candidate path inherited builders, forced a generated builders file, or intentionally disabled builders.

### 10. Add A Declared Source Snapshot Contract

Create a reusable helper for actions/tests that currently need a checkout:

- `build-tools/lang/source_snapshot.bzl`
- `build-tools/tools/dev/source-snapshot.ts`

The snapshot should be a declared Buck input/output artifact, not an ambient worker clone.

Contents:

- filtered repo source;
- `flake.nix` and `flake.lock`;
- `build-tools/tools/buck/graph.json` or a declared graph artifact;
- necessary `TARGETS` and `.bzl` files;
- generated provider files;
- no `.git`, `.direnv`, root `node_modules`, mutable `buck-out`, or local temp dirs.

Update Nix-invoking wrappers to accept a source snapshot in remote-ready mode. Local mode may continue using `WORKSPACE_ROOT`.

Remote-ready Nix evaluation must also stop depending on ambient `builtins.getEnv "WORKSPACE_ROOT"` for live-checkout discovery. Several package/planner files currently use that environment variable as part of impure evaluation. For remote-ready attrs, either:

- pass an explicit source snapshot path or graph path as a Nix argument; or
- set `WORKSPACE_ROOT` only to the declared snapshot root for that action/test, never to the worker's ambient checkout.

The source snapshot helper should make this distinction visible in generated manifests so policy checks can reject remote-ready attrs that still evaluate against the real repo root. Similar manifest fields are needed for any other impure Nix env value that can affect the attr. Remote-ready attrs should not consume undeclared values from `builtins.getEnv`; they should either take a declared artifact path/value from the manifest or be classified local-only.

Acceptance:

- A conformance test can run one tiny remote-ready action using only the snapshot and Nix cache inputs.
- Policy check fails if remote-ready wrappers still require implicit `WORKSPACE_ROOT` reads.
- Static tests identify Nix package/planner files that use `builtins.getEnv "WORKSPACE_ROOT"` and require an explicit remote-safe exemption or conversion plan before the owning attr can be marked `remote:ready`.
- Static tests identify new `builtins.getEnv` uses under `build-tools/tools/nix` and require each remote-relevant variable to be modeled in the remote env allowlist or explicitly marked local-only.

### 11. Add Declared Log And Artifact Outputs

Many current local wrappers write logs into `buck-out`, `/tmp`, or repo-root coverage directories. Remote-capable wrappers need declared output paths for:

- test stdout/stderr summaries;
- Nix build logs;
- selected output store-path manifests;
- coverage raw files;
- source snapshot manifests;
- remote conformance evidence.

Add a small artifact contract helper:

- `build-tools/tools/remote-exec/artifact-contract.ts`

The contract should define per-run/pass/target artifact directories, digest sidecars, redaction class, content type, and retention intent. Local mode can continue writing existing logs, but remote-ready wrappers must copy important logs into declared outputs or Buck reports.

Acceptance:

- Remote policy rejects `remote:ready` targets that write only to undeclared local paths.
- Event-log/report artifacts and wrapper artifacts share a run/pass/target naming scheme.
- Secret-like values are redacted before artifact summaries are written.
- Failed-input/output materialization artifacts are retention-scoped and require explicit remote policy opt-in.

### 12. Add Worker Tool Closure

Add `build-tools/tools/nix/flake/packages/remote-worker-tools.nix` and export it from `build-tools/tools/nix/flake/packages/default.nix` as the single repo-owned external-dependency surface for remote execution:

- `packages.<system>.remote-worker-tools`

Contents should be conservative:

- `bash`;
- coreutils;
- `findutils`;
- `gnugrep`;
- `gnused`;
- `gawk`;
- `git`;
- `nodejs_22`;
- `pnpm` if required by current wrappers;
- `buck2`;
- `zx-wrapper`;
- `timeout` provider;
- any test/build helper CLIs used by remote-ready wrappers;
- backend-selected RE worker daemon/sidecar packages once a backend is chosen, as separate Nix packages composed into the worker closure rather than installed by image scripts;
- helper scripts needed by Nix-invoking actions.

Do not include provider credentials, mutable registration state, SSH keys, cache tokens, or generated endpoint config in this generic closure. Backend-specific worker runtimes can be separate Nix packages or closures once a backend is selected, but they must still be realized through Nix and versioned by lockfile/source revision. Worker images may contain the minimal Nix bootstrap and host prerequisites, but repo tools, Buck, Node, pnpm, helper scripts, and RE runtime binaries used by the design must come from declared Nix outputs.

Optionally add:

- `apps.<system>.remote-worker-bootstrap`

The app should print or activate tool paths from the Nix closure and run local conformance checks. It should not register with a real scheduler by default.

Acceptance:

- `nix build .#remote-worker-tools --no-link --print-out-paths` works on supported systems.
- Closure includes expected binaries.
- No secrets or host-specific paths are embedded.
- Static tests reject remote-ready commands that invoke external tools not present in a declared Nix closure, declared Buck input, or materialization manifest.
- Worker bootstrap tests prove `PATH` for remote lanes is constructed from Nix store paths and does not require `/usr/local`, Homebrew, globally installed npm packages, or image-baked repo tools.

### 13. Add Generic Nix Cache Publish Manifests

Extend cache publishing beyond `wheelhouse-preload` with a new helper:

- `build-tools/tools/ci/publish-nix-cache-manifest.ts`

Responsibilities:

- build a configured list of attrs with `--no-link --print-out-paths`;
- archive flake inputs with `nix flake archive --json`;
- write a manifest containing system, source revision, flake lock hash, attr names, output paths, cache endpoint, and tool version;
- copy exact paths to a writable Nix store with the Nix binary from a declared closure, or emit paths for `attic push` / `cachix push` wrappers that are also provided by a declared Nix closure;
- keep backend-specific credentials outside the manifest.

Initial attrs:

- `.#graph-generator`
- `.#buck2-prelude`
- `.#test-seed`
- `.#remote-worker-tools`
- `.#toolchains.go`
- `.#toolchains.cxx`
- `.#toolchains.python`
- discovered `.#py-wheelhouse-*`
- discovered `.#node-modules.*`

Acceptance:

- Dry-run mode writes the manifest without pushing.
- Unit tests cover attr discovery and redaction.
- Existing `wheelhouse-preload` can call this helper or remain as a compatibility wrapper.

### 13a. Add CI And Service Client Tool Closures

Add one or more explicit CI/helper closures for service-facing tools used outside remote workers, for example:

- `packages.<system>.remote-ci-tools`
- optional backend-specific closures such as `packages.<system>.remote-cache-publisher-tools` or `packages.<system>.remote-artifact-tools` once providers are selected.

These closures should contain every external binary invoked by the dormant remote readiness tooling that does not run inside a Buck remote action:

- Nix CLI used by cache publishing and smoke tests;
- `buck2` used by run-summary and event-log helpers;
- Node runtime needed by TypeScript helper scripts;
- cache publisher clients or wrappers, such as Attic/Cachix/provider-specific upload tools once selected;
- object-store/artifact upload clients used by CI conformance artifacts;
- metrics/log shipping wrappers if the repo invokes them directly;
- provider CLIs only when the design requires a CLI rather than an API, and only as Nix packages.

Generated endpoints, tokens, SSH key paths, workload identity handles, trust roots, machine files, and bucket/cache names remain runtime config or secrets. They are not Nix package contents.

Update CI helper scripts so remote lanes invoke tools through these closures or through `nix run` / `nix develop` wrappers that select these closures. Do not depend on globally installed `attic`, `cachix`, cloud CLIs, Node, Buck2, or shell utilities in CI images.

Acceptance:

- `nix build .#remote-ci-tools --no-link --print-out-paths` works on supported CI systems.
- Cache publishing, artifact upload, remote-builder smoke, Buck run-summary, and event-log checks can run with `PATH` restricted to the declared CI/helper closure plus host primitives.
- Static tests reject remote readiness scripts that invoke provider/cache/artifact CLIs not listed in a declared Nix closure.
- CI local lanes remain unchanged unless a remote policy explicitly selects the helper closure.

### 13b. Add A Nix Store Path Materialization Contract

Cache publication does not make a store path available inside a remote Buck action. A remote worker may start with an empty or partially warm `/nix/store`, so remote-ready tests/actions must explicitly materialize required store paths from declared data.

Add a small materialization contract and helper pair:

- `build-tools/tools/remote-exec/nix-store-materialize.ts`
- `build-tools/lang/nix_store_materialize.bzl`

Responsibilities:

- consume a declared manifest listing store paths, attr names, source revision, flake lock fingerprint, substituter endpoint identity, and trusted public keys;
- realize each required path with `nix copy --from <substituter>` or a remote-safe `nix build --no-link --print-out-paths` against the declared source snapshot;
- verify the realized output path matches the manifest before executing the test/build command;
- emit a declared materialization report containing path, nar hash when available, substituter used, duration, and cache-hit/miss classification;
- fail remote mode if a required path is referenced only as a plain string and not listed in the manifest.

This helper should be dormant and usable locally for conformance tests. It should not install global substituters or write credentials into the manifest.

Every external dependency needed by a remote-ready action must enter through one of these Nix-backed paths:

- a package in `remote-worker-tools` or a backend-specific Nix worker runtime closure;
- a target-specific Nix output listed in the materialization manifest;
- a declared Buck artifact such as a source snapshot, script, graph, or generated config.

Host PATH tools are local-mode conveniences only. Remote policy should reject `remote:ready` targets that require `command -v`, `/usr/bin`, `/usr/local/bin`, Homebrew paths, globally installed npm/pip/cargo tools, or image-baked helper binaries unless the resolved path is from a declared Nix store closure.

Acceptance:

- Unit tests cover manifest parsing, command rendering, redaction, and path mismatch failures.
- Remote policy rejects `remote:ready` targets that reference `/nix/store/...` paths without a declared materialization manifest.
- A local dry-run can prove the helper would realize `.#remote-worker-tools`, `.#test-seed`, and one selected target output from a configured substituter.

### 14. Add Remote Builder Smoke Tooling

Add:

- `build-tools/tools/remote-exec/nix-remote-builder-smoke.ts`

Checks:

- print effective Nix config relevant to builders, substituters, trusted keys, and `max-jobs`;
- detect `.envrc` masking of `builders =`;
- run `nix store info --store <builder-uri>` when a URI is provided;
- run a small eligible build such as `.#graph-generator --no-link --rebuild`;
- fail with actionable diagnostics.

This tool should not change global Nix config and should not set builders by default.

Acceptance:

- Local no-builder run reports local-only config clearly.
- Tests cover parsing/rendering of `NIX_CONFIG`.

### 15. Add Buck Event Log Verification Parser

Add:

- `build-tools/tools/remote-exec/buck-event-log-remote-check.ts`

Input:

- Buck event log path;
- selected targets/passes;
- expected mode.

Behavior:

- use `buck2 log what-ran` where possible rather than hand-parsing protobufs;
- classify actions as remote, cache, dep-file-cache, local, worker, or unknown;
- fail a remote conformance lane if remote-ready actions ran locally;
- allow explicitly local-only targets.

This should be dormant until event logs exist, but the parser can be tested against captured fixtures.

Acceptance:

- Fixture tests cover remote, cache hit, and local classifications.
- Parser treats event-log JSON/JSONL schema as pinned-version input, not a stable public API.

### 15a. Add Buck-Native Run Summary Collection

Add a dormant reporting helper that derives remote-run summaries from Buck-native commands before adding repo-specific interpretation:

- `build-tools/tools/remote-exec/buck-run-summary.ts`

Inputs:

- event log path;
- build id path;
- command report path;
- selected targets/passes;
- artifact output directory.

Behavior:

- run `buck2 log what-ran` for executor/cache classification;
- run the pinned Buck2 equivalents for `summary`, `critical-path` or `slowest-path`, `what-uploaded`, and `what-materialized` when supported by the pinned Buck2 version;
- normalize outputs into a redacted summary containing selected profile, config fingerprint, target/pass, action counts, remote/cache/local classifications, slowest actions, uploaded/materialized byte counts when available, and unsupported-command notices;
- treat missing or unsupported Buck log subcommands as explicit version-gated fields, not silent success;
- avoid inventing a custom telemetry schema until Buck-native artifacts have been captured.

Acceptance:

- Fixture tests cover supported and unsupported Buck log subcommands for the pinned Buck2 version.
- Summary output is redacted and references artifact paths/digests rather than embedding raw logs.
- Remote conformance can fail on event-log evidence while still emitting partial summaries for diagnosis.

### 16. Coverage Artifact Readiness

Remote tests cannot write directly to repo-root `coverage/`.

Change the coverage contract before enabling remote mode:

- tests write raw V8 coverage to declared per-test outputs or run-artifact directories;
- verify aggregation downloads/materializes raw coverage into a local merge directory;
- `pnpm coverage:build` runs once after all passes finish.

Local mode can continue using the current path until this is needed, but the remote policy check must reject coverage+remote for wrappers that do not declare coverage outputs.

Acceptance:

- Local coverage remains unchanged.
- Remote mode with coverage fails fast until declared coverage outputs are implemented.

### 17. Add Operator-Facing Documentation And Examples

Add local-only docs for the new dormant surfaces:

- how to render a redacted remote Buck config into `buck-out/tmp`;
- how to run the Nix remote-builder smoke tool;
- how to run cache manifest dry-run;
- how to run a future conformance lane against a single `remote:ready` target;
- how to confirm local defaults remain local-only.

These docs should not contain production endpoints or credentials.

Acceptance:

- Examples use placeholder endpoints and file paths.
- The docs state that remote execution is not enabled by default.

## Rule Family Readiness Matrix

| Family                               | Current state                                                                                                        | Required before `remote:ready`                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `zx_test`                            | Heavy `WORKSPACE_ROOT` mutation; creates temp `.buckconfig`, `prelude`, `node_modules`, shims, logs under `buck-out` | Add executor propagation, then split local bootstrap from remote snapshot mode; declare scripts/templates/node modules; declared logs/coverage |
| `node_nix_test`                      | Invokes Nix via filtered flake, reads importer under workspace, prepares pnpm store                                  | Add executor propagation; declare importer source snapshot; make pnpm store/cache materialization explicit; declared coverage/log outputs      |
| `go_nix_test`                        | Invokes selected Nix build from `WORKSPACE_ROOT`; runs binary from store path                                        | Add executor propagation; declared graph/source snapshot; no workspace log writes; exact store path realization from cache                     |
| `python_nix_test`                    | Same pattern as Go                                                                                                   | Same as Go; ensure wheelhouse cache attrs are published                                                                                        |
| `cpp_nix_test`                       | Same pattern plus `/tmp/cpp_nix_test_build.log`                                                                      | Same as Go; move log to declared temp/output                                                                                                   |
| Go/Python/C++/Rust Nix build actions | `ctx.actions.run` shell fragments read workspace and graph paths                                                     | Add remote execution platform later only after declared source snapshot and no undeclared workspace reads                                      |
| Deployment-domain tests              | Many interact with external services/secrets                                                                         | Keep local-only until action classes, locks, idempotency, and credential boundaries are implemented                                            |

All external-runner rows also require command-handle cleanup before `remote:ready`; executor propagation is only the selection plumbing, not proof that Buck can materialize the test command remotely.

## Inactive Enablement Flow

After the code changes above, enabling a real remote lane should require only:

1. provision Buck2-compatible RE endpoint/CAS/action cache;
2. provision Linux worker pools and a Nix binary cache;
3. set CI secrets as files/workload identity;
4. generate the remote Buck config;
5. set `VBR_REMOTE_EXEC_MODE=hybrid` or equivalent for a conformance lane;
6. mark one tiny rule family/target `remote:ready`;
7. run verify with event-log remote checks;
8. expand target coverage incrementally.

No source rule should become remote-capable merely because `[buck2_re_client]` exists.

## Work To Actually Enable Remote Builds And Tests Later

This section is intentionally separate from the readiness work. None of these steps should be performed until remote machines, cache service, credentials, and an RE backend are approved.

### 1. Provision Runtime Infrastructure

Required runtime pieces:

- Buck2-compatible RE scheduler, CAS, and action-cache endpoints;
- Linux worker pools for `x86_64-linux` and `aarch64-linux`;
- a decided `aarch64-darwin` lane: remote macOS RE workers or dedicated local/on-demand macOS executors with the same reporting contract;
- Nix binary cache with read credentials for workers/CI and write credentials only for publisher jobs;
- optional SSH Nix remote builders registered through generated `/etc/nix/machines`;
- object store or artifact service for Buck event logs, command reports, build reports, coverage, Nix logs, and conformance evidence;
- metrics/logging for worker health, queue depth, cache hit rate, preemptions, and failures.

These are infrastructure dependencies, not permission to install arbitrary tools on workers or CI hosts. Any repo-used service binary, worker runtime, sidecar, uploader, cache client, metrics/log shipper wrapper, SSH client, workload-identity helper, worker-registration command, or provider CLI needed to interact with these services must be packaged by Nix and included in `remote-worker-tools`, a backend-specific worker closure, or a CI helper closure. Endpoints, credentials, instance identities, machine files, trust roots, network routes, disks, clocks, and kernel features remain runtime environment/config. They must not be baked into the Nix outputs.

### 2. Install Worker Images

For each worker pool:

- install host-level primitives only: Nix bootstrap, network reachability, mounted credentials or workload-identity material, certificates/trust anchors, sandbox/kernel support, disks, clocks, and platform-provided health endpoints;
- configure trusted Nix substituters and public keys;
- realize `.#remote-worker-tools` from the approved cache;
- realize and activate the selected RE worker daemon/sidecars from backend-specific Nix closures;
- verify worker platform properties match the dormant Buck profile vocabulary;
- reject registration until Nix cache trust, tool closure activation, sandbox checks, and clock sync pass.

Do not bake mutable repo tools, language runtimes, Buck binaries, helper CLIs, RE runtime binaries, worker registration tools, artifact/cache/metrics clients, or credentials into worker images. Images can include only the minimal host bootstrap needed to fetch and activate Nix closures plus non-executable machine primitives outside the repo dependency graph. Any executable used by the repo's worker bootstrap or CI flow must be in a declared Nix closure, even if the platform also provides a host copy.

### 3. Configure CI Secrets And Generated Config

In CI only:

- mount RE client credentials as files or workload-identity material;
- mount cache publisher credentials only in publisher stages;
- mount cache read credentials for test/build stages;
- render the Buck remote config into `buck-out/tmp/remote-exec/<run-id>/`;
- export `VBR_REMOTE_BUCK_CONFIG`, `VBR_REMOTE_EXEC_MODE`, `VBR_REMOTE_EXEC_SYSTEM`, and `VBR_REMOTE_ARTIFACT_DIR` only for the intended remote lane;
- keep the default Jenkins matrix local until the conformance lane is stable.

### 4. Populate Cache Warm Paths

Before the first remote test lane:

- run the cache manifest publisher for flake archive inputs, `.#buck2-prelude`, `.#remote-worker-tools`, `.#graph-generator`, `.#test-seed`, toolchains, wheelhouses, and node modules;
- verify workers can substitute those paths without broad credentials;
- run the remote-builder smoke tool if SSH Nix builders are part of the lane;
- record cache endpoint, public key, manifest digest, source revision, and flake lock fingerprint in the run summary.

### 5. Start With One Conformance Target

Pick one tiny target that has already been converted to `remote:ready`.

Run it with:

- `VBR_REMOTE_EXEC_MODE=remote-only-conformance`;
- generated remote Buck config;
- `--unstable-allow-compatible-tests-on-re`;
- event log, build report, command report, and build id output paths;
- remote policy check enabled as a hard failure.

Acceptance before expanding:

- `buck2 log what-ran` evidence shows execution through RE or a permitted remote cache hit;
- no action uses `Local`, `Worker`, or undeclared host paths unless explicitly allowed;
- worker has no ambient checkout dependency;
- Nix paths are realized from cache or declared manifests;
- artifacts are uploaded and redacted;
- retry/preemption behavior is understood for the target's action class.

### 6. Expand By Rule Family

Expand only one rule family at a time:

1. mark a small set of targets `remote:ready`;
2. run remote-only conformance;
3. run hybrid CI lane;
4. compare local and remote results;
5. inspect event logs for local fallback or undeclared-input symptoms;
6. then broaden target coverage.

Do not enable deployment-domain or external-mutating tests until run locks, idempotency, fencing, recovery evidence, and credential scopes are implemented and tested.

### 7. Promote CI Lanes Deliberately

Promotion order:

1. ad hoc remote conformance lane;
2. optional Jenkins stage for one smoke target;
3. optional Jenkins stage for selected remote-ready shared tests;
4. hybrid lane for larger remote-ready sets;
5. remote-preferred lane only after fallback semantics and capacity are stable.

The default local lane should remain available as a parity and incident fallback path.

### 8. Operational Go/No-Go Checks

Before broad enablement:

- worker queue age, capacity, and preemption dashboards exist;
- CAS/action-cache and Nix cache hit rates are visible;
- cost and quota limits are enforced;
- artifact retention and redaction checks are passing;
- secret rotation and revocation are tested;
- local-only policy exceptions are documented;
- the macOS lane has equivalent reporting, even if it is not remote RE.

Remote execution becomes a normal CI path only after these checks are green for multiple runs.

### 9. Add Remote Operations Control-Plane Code If Self-Managing Workers

This is not required for the dormant readiness changes above, and it may be unnecessary if the selected RE provider supplies fleet management, worker registration, run metadata, and observability. If the repo owns spot worker lifecycle or run orchestration around a generic RE backend, add a provider-neutral operations subsystem before broad enablement.

Code/data model surfaces:

- run envelopes for source revision, graph identity, platform matrix, target selectors, execution policy, cache namespace, Buck config fingerprint, requester, and immutable run id;
- run children for each platform/pass, carrying Buck invocation identity, pass profile, artifact refs, terminal outcome, and aggregation status;
- run attempts with idempotency keys, retry cause, terminal status, redacted failure summary, and in-doubt state;
- worker pools and worker instances with provider, region, system, resource class, lifecycle class, image digest, capability set, registration status, drain/preemption status, and heartbeat;
- worker registration leases with expiry, drain/preemption signal, and admission checks for cache trust, tool closure activation, sandbox checks, and clock sync;
- scaling decisions with observed demand, desired/current capacity, provider response, quota/budget result, cooldown reason, and snapshot timestamp;
- run outputs containing Buck event logs, command/build reports, coverage refs, Nix materialization reports, verify summaries, and failed-target summaries;
- audit events and optional run locks for external-mutating test classes.

Boundaries:

- Buck2/RE remains the action scheduler and owner of action leasing, retries, CAS/action-cache state, and action terminal status.
- Repo control-plane state observes Buck/RE outcomes and manages fleet/run policy around it; it must not become a second test execution scheduler.
- Deployment-domain credential and lifecycle tables should not be reused directly for generic remote execution. Share primitives only where boundaries and redaction classes remain explicit.

Acceptance:

- The selected enablement path documents whether this subsystem is needed or intentionally delegated to the RE provider.
- Schema tests enforce closed state vocabularies, immutable IDs, idempotency keys for retryable requests, redaction classes, retention policy fields, and migration strategy.
- Worker admission tests reject stale capability snapshots, missing cache trust, missing `remote-worker-tools`, missing sandbox prerequisites, or unpinned worker image identity.
- Aggregation tests fail when child runs disagree on source revision, graph digest, flake lock fingerprint, Buck2 version, RE config fingerprint, or cache namespace.

## Validation Plan

### Local Regression Gates

- `node build-tools/tools/ci/run-stage.ts --stage buck-test` still runs locally through verify planning.
- `buck2 test //...` remains usable for direct local test runs.
- `v` remains local by default.
- No developer needs RE credentials after these changes.
- Guard tests prove committed defaults do not include `[buck2_re_client]`, remote execution platforms, default remote profiles, or Jenkins remote env settings.

### Static Tests

- `.buckconfig` has no committed production endpoints.
- generated remote config redacts or rejects inline secrets.
- all remote profile names referenced by verify exist in `toolchains//:remote_test_execution`.
- remote profile names referenced by verify are connected to a real activation mechanism: target `remote_execution` attrs or an explicitly selected alternate remote test toolchain.
- every remote-ready label has an allowed rule family.
- every local-only target is rejected in remote mode.
- remote-ready external-runner wrappers declare actual command inputs instead of relying only on stamp-action hidden inputs.
- remote-ready Nix wrappers/actions do not pass `--builders ""` unless they are explicitly classified as local-only and therefore rejected by remote mode.

### Nix Tests

- selected builds use `--no-link`.
- `remote-worker-tools` builds for supported systems.
- `remote-ci-tools` builds for supported CI systems.
- cache manifest dry-run includes exact output paths and flake archive paths.
- materialization manifest tests prove remote-ready actions cannot rely on pre-existing worker store paths.
- remote builder smoke parser detects empty `builders =` from `.envrc`.
- remote dependency closure tests prove every external CLI/runtime referenced by remote-ready wrappers, worker bootstrap, cache publishing, and artifact upload is available from declared Nix outputs.
- allowed primitive inventory tests list the non-Nix runtime prerequisites and fail if the design or implementation treats an executable as a primitive instead of a Nix-provided dependency.

### Buck Tests

- local `spawnVerifyBuck2Tests` argv snapshot unchanged.
- remote argv snapshot includes config, reports, event log, and compatible-tests flag.
- remote artifact/debug snapshot covers optional test-executor stdout/stderr and failed-input/output materialization flags, proving they default off.
- wrapper provider tests show executor propagation only when `remote_execution` is set.
- activation-path tests prove verify-selected profile names can reach `get_re_executors_from_props(ctx)` rather than remaining verify-only metadata.
- provider/policy tests prove `local_resources` and `required_local_resources` targets are rejected for remote-only conformance unless explicitly modeled as worker capabilities or hybrid fallback.
- provider/policy tests prove `network_access` is rejected for remote-only conformance unless explicitly modeled as reviewed remote egress capability with required credential and lock policy.
- remote env argv snapshot excludes local-only paths and daemon sockets.
- target expansion cquery and Buck test execution use matching target-platform/config options in remote mode.
- Buck run-summary fixture tests cover `what-ran`, summary, critical-path or slowest-path, upload, and materialization reporting for the pinned Buck2 version.
- remote argv/env tests prove `PATH` is Nix-store based in remote lanes and does not rely on developer or image-global tool installs.

### Conformance Lane Later

When an RE backend exists:

- run one `remote:ready` smoke target with `--remote-only`;
- inspect `buck2 log what-ran` and fail on `Local` execution;
- verify worker lacks ambient checkout credentials;
- verify Nix substitution succeeds from configured cache;
- verify no secrets appear in Buck, Nix, or worker logs.

## Non-Goals

- Do not choose a production RE vendor in this design.
- Do not enable remote execution in default `.buckconfig`.
- Do not commit endpoint addresses, tokens, cache keys, or builder SSH paths.
- Do not implement a custom action scheduler.
- Do not make deployment-domain tests remote until their external-state contracts are explicit.
- Do not require dynamic derivations, recursive Nix, or content-addressed derivations for remote readiness.

## Suggested Implementation Sequence

1. Add non-enablement guard tests.
2. Add remote config generator and tests.
3. Add dormant toolchain profiles and execution platform targets with no default selection.
4. Extend verify args/pass policy and `spawnVerifyBuck2Tests` argv construction, defaulting local.
5. Add the dormant remote test profile activation mechanism and tests.
6. Move CI `buck-test` onto verify pass planning while keeping Jenkins local-only.
7. Add remote-safe verify test environment handling.
8. Add executor propagation to repo-owned test wrappers, still defaulting local-only.
9. Move external-runner command inputs onto declared command handles.
10. Add remote readiness labels, build-action `local_only` defaults, and policy check.
11. Add `--no-link` to selected builds, split verify seed local/remote modes, and classify Nix builder policy at call sites.
12. Add declared log/artifact output contracts.
13. Add `remote-worker-tools`.
14. Add `remote-ci-tools` and require cache/artifact/service clients to come from declared Nix outputs.
15. Add cache manifest publisher dry-run.
16. Add Nix store path materialization contracts.
17. Add Buck event-log verification and Buck-native run-summary collection.
18. Add source snapshot contract and convert one tiny smoke target to `remote:ready`.
19. Add operator docs and local examples.

The first nine steps make remote enablement mostly a configuration problem without changing actual execution. Steps ten through eighteen create the guardrails needed before any meaningful test volume should be sent to remote workers.
