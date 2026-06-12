# 38. Test Remote Execution of Builds & Tests

**Tier:** Advanced Capabilities
**Priority:** 38 of 44
**Depends on:** #4 Containerize Control Plane, #5 Kubernetes / OpenTofu Deployment
**Estimated effort:** L
**Date:** 2026-05-25
**Summary:** Assess whether Buck2 remote execution is worth pursuing at current repo scale, evaluate at least two RE providers against the pinned Buck2 commit, and either configure a trial or produce a documented decision record for deferral.

**Current status note:** This task is a planning record. The current setup and local conformance
commands live in [`../../build-tools/docs/remote-build-setup.md`](../../../build-tools/docs/remote-build-setup.md).
The repo now has dormant named remote-execution profiles and platform wiring, but no default live
Buck2 RE client config is selected.

## What

Evaluate whether Buck2 remote execution (RE) is worth enabling for this repo, and if the answer is
yes, configure and validate it.

Buck2 RE distributes build actions and test runs to a pool of remote workers via the REAPI protocol
(the same protocol used by Bazel Remote Execution). Instead of building and running tests locally,
Buck2 sends each action (compile, link, test) to a remote worker, retrieves the outputs, and populates
the local cache from the remote result. At sufficient scale this can run thousands of actions in
parallel across a worker pool rather than being bounded by the cores of the local or CI machine.

This repo already has the structural prerequisites in place:

- **`toolchains/remote_test_execution.bzl`** is wired and declared as
  `toolchains//:remote_test_execution` in `toolchains/TARGETS`. It delegates to
  `@prelude//toolchains:remote_test_execution.bzl`, which exposes the `profiles` and `use_case`
  attributes Buck2 uses to route test actions to remote workers. The toolchain target is already
  declared with `visibility = ["PUBLIC"]`.
- **`prelude/decls/re_test_common.bzl`** is present and defines the full `re_opts` schema:
  `capabilities`, `use_case`, `remote_cache_enabled`, `resource_units`, `local_enabled`, and
  `remote_execution_dynamic_image`. These attributes can be set on individual test targets or
  through the toolchain profile.
- **Hermetic Nix builds** ensure that all build inputs are content-addressed and reproducible. This
  is the necessary condition for RE correctness: a remote worker must be able to produce bit-for-bit
  identical outputs from the same declared inputs. The repo's Nix + Buck2 dynamic-derivation design
  already satisfies this; `NIX_GO_DEV_OVERRIDE_JSON`, `NIX_CPP_DEV_OVERRIDE_JSON`, and related
  overrides are forbidden in CI precisely because they break content-addressability.
- **Existing `remote-build-setup.md`** documents Nix remote builders and binary cache configuration
  as a separate, already-explored capability. That is Nix-level distribution (delegating `nix build`
  over SSH). Buck2 RE is orthogonal and sits one layer up: it distributes Buck actions (including
  the `buck2 test` invocations that exercise Nix-built artifacts) to a worker pool via REAPI.

The task has three sequential parts:

1. **Assess**: Determine whether the current repo scale (number of targets, CI wall-clock time,
   developer iteration bottleneck) justifies the operational cost of running an RE service. Pull
   actual `buck-test` stage wall-clock times from Jenkins across recent builds for each matrix
   axis (`aarch64-darwin`, `aarch64-linux`, `x86_64-linux`). Compare against the overhead of
   provisioning and maintaining an RE worker fleet.

2. **Select and trial**: If the scale justifies it, choose an RE backend. Options compatible with
   Buck2 REAPI include EngFlow, BuildBuddy, and self-hosted implementations (e.g., the open-source
   `bazel-buildfarm` or `remote-apis-testing` reference server). Wire the Buck2 `.buckconfig` RE
   section (`[buck2_re_client]` and related config) to point at the trial endpoint. Configure
   `toolchains//:remote_test_execution` with a trial profile.

3. **Validate**: Run `buck2 build //...` and `buck2 test //projects/...` against the RE endpoint
   and verify: (a) actions execute remotely (observable in `buck2` event log and RE service logs),
   (b) outputs are identical to local builds (compare content hashes), (c) test results match
   (`PASS`/`FAIL` outcomes, not infrastructure errors), and (d) wall-clock time improvement is
   measurable across the matrix axes.

## Why Now

Priority 36 reflects that this is an exploratory capability task with no hard downstream blockers.
The question mark in the name is intentional: this task exists to find out whether the payoff is
real at the current repo scale, not to unconditionally adopt RE.

The structural prerequisites (hermetic builds, RE toolchain declaration, Nix content-addressing)
are already in place. They were built for correctness, not for RE, but they are exactly what RE
requires. The cost of evaluating RE is bounded: if the assessment in part 1 shows that CI
wall-clock times are already acceptable and the repo does not have enough long-running
compile-heavy targets (e.g., heavy C++ link steps, large Rust crates) to saturate a worker pool,
the correct answer is "not yet" and no further work is needed.

The dependency on #4 (containerized control plane) and #5 (Kubernetes) reflects the pragmatic
reality that RE workers are themselves containerized workloads. Running them anywhere sensible
requires an existing container hosting story. It would be wasteful to evaluate RE before the repo
has a stable substrate for running additional containerized services.

## Risks

**Toolchain-worker environment mismatch.** Buck2 sends actions to remote workers with declared
`capabilities` (e.g., OS, CPU architecture, required tools). If the worker container does not have
the exact Nix-resolved toolchain paths that the Buck action expects, the remote build will fail with
missing-binary errors rather than determinism failures, making the root cause non-obvious. The Nix
toolchain resolution in this repo is per-host (resolved by `nix develop`); the RE worker must either
run inside a Nix shell or have the exact same store paths pre-populated from the binary cache.

**Cross-architecture matrix.** The Jenkins matrix currently builds and tests on `aarch64-darwin`,
`aarch64-linux`, and `x86_64-linux`. RE workers would need to cover the same `system` strings.
Most RE services do not offer `aarch64-darwin` workers. macOS remote execution for Buck2 is
technically possible but is poorly supported by REAPI services. In practice, RE may only be viable
for the Linux matrix axes, leaving macOS builds on local agents as before.

**REAPI compatibility with the pinned Buck2 version.** The repo pins Buck2 at commit
`201beb86106fecdc84e30260b0f1abb5bf576988`. RE backend compatibility depends on the REAPI version
Buck2 uses at that commit. Before selecting a backend, confirm that the pinned Buck2 version's
REAPI client is compatible with the chosen service's REAPI server version.

**Content-addressability of Nix-backed actions.** Buck2 RE requires that actions are fully
hermetic: all inputs declared, all outputs declared, no undeclared reads. The repo's Nix dynamic-
derivation design satisfies this for the Nix build layer, but Buck actions that invoke `nix build`
internally (rather than consuming pre-built Nix outputs) may declare `nix build` itself as a
sandboxed action. Sending such actions to a remote worker requires that the worker has Nix installed
and the flake inputs available — a significant worker provisioning requirement.

**Cost.** Managed RE services (EngFlow, BuildBuddy cloud) are billed per action-minute on remote
workers. At small repo scale, the cost may exceed the time saved. Self-hosted RE reduces unit cost
but adds infrastructure maintenance. Part 1 (Assess) must include a cost-benefit estimate before
any service is contracted.

## Trade-offs

**Nix remote builders vs. Buck2 RE.** `build-tools/docs/remote-build-setup.md` already documents
Nix remote builders: delegating `nix build` over SSH to a remote Linux or macOS host. This is
simpler to set up (no REAPI service, just SSH and `nix-daemon`) and solves the cross-compilation
problem (macOS can delegate Linux builds to a Linux builder). Buck2 RE is broader: it distributes
all Buck actions, including test runs, not just Nix build steps. The two are complementary, not
mutually exclusive. If only the Nix build stages are slow, Nix remote builders may be the cheaper
intervention. If Buck test actions (Go test, C++ test, Python test) are the bottleneck, Buck2 RE
addresses those where Nix remote builders do not.

**Self-hosted vs. managed RE service.** A self-hosted RE cluster (e.g., `bazel-buildfarm` on the
Kubernetes cluster from #5) avoids per-action billing and keeps source code off third-party
infrastructure. The cost is ongoing maintenance of the worker fleet, autoscaling configuration, and
worker image management. A managed service (EngFlow, BuildBuddy) offloads that but requires sending
build inputs — source files and intermediate artifacts — to a third-party service, which has
supply-chain and confidentiality implications.

**RE for tests only vs. RE for builds and tests.** `toolchains//:remote_test_execution` is scoped
to test execution. Enabling RE for build actions (compilation, linking) is a separate, broader
configuration. A staged adoption — RE for tests first, RE for builds second — limits the blast
radius of a misconfiguration and makes it easier to attribute any correctness regressions.

**RE vs. local parallelism with a faster CI agent.** At current repo scale, upgrading CI agents to
machines with more cores may deliver comparable wall-clock improvements to RE without the REAPI
operational complexity. This should be included in the part 1 assessment as the baseline
alternative.

## Considerations

**The RE toolchain declaration is present but unselected by default.**
`toolchains//:remote_test_execution` has dormant named profiles and `default_profile = None`.
Activating RE requires selecting a reviewed profile and generated Buck2 client config for the target
workers; developer defaults must remain local unless explicitly opted in.

**Committed `.buckconfig` RE client config must stay absent by default.** A generated or
CI-selected Buck2 RE client config is where endpoint URLs, TLS configuration, and HTTP headers are
declared. Do not add unsupported local enablement keys; use the renderer and default-local policy
checks documented in the remote-build setup guide.

**Hermetic inputs must not include volatile host paths.** The `flake.nix` `allowed-impure-env-vars`
list already contains a documented set of env vars that are allowed to pass into derivations.
Before sending Buck actions to remote workers, audit whether any of those env vars are referenced
inside Buck action inputs. Remote workers do not receive host env vars by default; actions that
depend on them will fail deterministically on RE but pass locally. This is the most likely source
of "works locally, fails remotely" bugs.

**macOS RE limitation.** If EngFlow or BuildBuddy are evaluated, confirm their macOS worker
availability and pricing before committing to them as the RE backend. The matrix's `aarch64-darwin`
axis may need to remain on local Jenkins agents regardless of the RE decision for the Linux axes.

**Output from part 1 determines whether parts 2 and 3 proceed.** Write the assessment as a short
decision document: current `buck-test` stage wall-clock by matrix axis, dominant action types
(compile, test, link), estimated speedup at 10x / 50x parallelism, estimated RE cost at those
parallelism levels, and a recommendation (proceed / defer / drop). If the recommendation is
"defer" or "drop," close this task with that document as the artifact and record the decision in
`docs/adrs/` so future scale changes have a reference point.

**`build-tools/docs/remote-build-setup.md` now covers both layers.** The guide separates Nix remote
builders/binary caches from dormant Buck2 REAPI configuration and local conformance evidence.
