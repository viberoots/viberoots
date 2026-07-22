# Hermetic Builds Design

Status: implemented; independent-builder release evidence pending

## Purpose

This document defines the architecture and evidence required for us to claim that production
artifacts built through `b` are hermetic. It separates that claim from developer workflows that
intentionally use live, uncommitted source for hot reload, temporary repositories, or package
patching.

Our target claim is:

> For a fixed platform, the artifact produced by `b` is determined only by reviewed, declared,
> content-addressed inputs. Ambient host state cannot alter the artifact, and the build fails when
> an undeclared input is required.

The Nix daemon, configured builders, trusted substituters, and pinned Nix inputs remain part of the
trusted computing base. Cross-platform outputs need not be byte-identical. Repeated builds for the
same platform and declared inputs must be identical.

## Current State

Artifact construction now uses one canonical policy, immutable evaluation bundles, reviewed store
tools and environment, and fail-closed sandbox, network, publication, and deployment admission.
Relevant local untracked input selects a non-release development bundle; protected jobs reject it.
Normal `i` and `b` remain read-only, while `u` is the sole repair boundary. CI contains the protected
six-family, three-system, two-builder reproducibility lane and signed aggregate authority.

The repository implementation and local validation gates are complete, but the full hermeticity
claim remains disabled until release administration provisions six independent builder authorities,
runs the protected lane for the frozen revision, and retains the signed aggregate and readback
evidence. Ordinary local full-suite validation proves the machinery, not independent builders.

## Definitions

- **Hermetic artifact build:** source, graph, dependency, toolchain, configuration, and platform
  inputs are explicit and immutable before execution. Undeclared host files, tools, environment,
  network services, and clocks are unavailable.
- **Pure evaluation:** Nix does not use `--impure`, ambient selectors, mutable path lookup, or
  host-dependent builtins. Every path is a flake input or immutable store path.
- **Development build:** a local workflow whose immutable bundle includes relevant untracked source.
  It still evaluates purely with store tools, but its output is ineligible for release, cache
  publication, provenance attestation, or the hermetic-build claim.
- **Reproducible artifact:** independent same-system builders produce the same output store path and
  NAR hash from identical declared inputs.

## Command Contract

The command boundaries are authoritative:

- `u` is the only normal command that repairs or updates tracked dependency and generated metadata.
- `i` is read-only for tracked state. It realizes declared dependencies and fails on stale metadata.
- `b` is read-only. With no relevant untracked input it builds the hermetic bundle. Locally, relevant
  untracked input automatically selects a labeled development bundle; CI and release jobs fail.
- `v` verifies the hermetic contract and runs both positive and negative enforcement tests.
- `d` runs live development commands and preserves hot reload.
- `b --impure` is reserved for explicit diagnostics and is never selected automatically.

CI, release, deployment, cache-publication, and provenance jobs reject relevant untracked input and
`--impure`. Local development-bundle output carries a visible and structured non-release
classification. Inventory failure fails closed instead of guessing a source mode.

`b` fails with actionable diagnostics for stale metadata, non-store tools, undeclared selectors or
host paths, and noncompliant sandbox or builder policy.

## Immutable Evaluation Bundle

We will replace environment-selected graph evaluation with one immutable evaluation bundle per
content identity. The bundle contains only reviewed inputs needed to evaluate the requested build:

```text
evaluation-bundle/
├── source/                  # filtered consumer source
├── viberoots/               # filtered, immutable viberoots input
├── graph.json               # exported Buck graph
├── selection.json           # requested labels and platform
├── classification.json      # hermetic or local-development
├── dependency-inputs.json   # lock/hash/provider identities
└── schema.json              # bundle version and input digests
```

The materializer filters with the existing source-role policy, rejects external paths, copies graph
and selectors into the bundle, and adds it to `/nix/store` once per content identity. The outer flake
uses only immutable store inputs. Bundle digests support diagnostics and provenance. Construction
roots are removed after success, failure, timeout, or owner termination.

The hermetic bundle contains declared source, including modified tracked files. A local development
bundle additionally contains relevant untracked files selected by the same source-role policy. Both
exclude recursive workspace state, outputs, caches, logs, closures, credentials, unrelated projects,
and mutable host paths. Unchanged warm construction preserves store and registration identity.

`BUCK_GRAPH_JSON`, `BUCK_TARGET`, `WORKSPACE_ROOT`, language override variables, and root lockfile
selectors must no longer influence hermetic Nix evaluation through `builtins.getEnv`. The evaluator
reads their normalized equivalents from the bundle. Development-bundle evaluation remains pure;
diagnostic `--impure` is never a fallback for `b`.

## Environment Policy

We will introduce one canonical environment builder with named modes rather than spreading
`...process.env` across orchestration code.

Hermetic mode may pass only store-qualified tools, Nix daemon connection data, isolated home/temp
roots, reviewed certificate paths, deterministic locale/timezone, non-artifact Buck console and
isolation controls, the bundle path, and CI/platform policy classification.

Variables affecting source, dependency, compiler, linker, package resolution, or runtime behavior
must be represented in the bundle or derivation. They must not be inherited. This includes common
host variables such as compiler flags, language search paths, package-manager homes, development
overrides, and user configuration directories.

Trusted shell ingress may receive `NIX_CFLAGS_COMPILE`, `NIX_PROFILES`,
`NIX_USER_PROFILE_DIR`, and `XPC_FLAGS` as devshell session inputs. The shell removes them before
canonical TypeScript admission; they never become bundle, derivation, or runtime inputs. Other
caller compiler, language, and package selectors that differ from the trusted devshell baseline are
restored so canonical admission can reject them explicitly.

The environment builder must reject unknown artifact-affecting variables in CI. Local `b` should
strip harmless unknown variables and fail on known build selectors. Remote execution must use the
same policy, with an even smaller transport allowlist.

## Sandbox And Network Policy

Startup and CI preflight must inspect effective Nix configuration and require:

- sandboxing enabled for local artifact builders;
- sandbox fallback disabled;
- multi-user daemon execution where supported;
- reviewed local or remote builders only;
- trusted substituters and public keys from reviewed configuration;
- no unrestricted host path added through sandbox exceptions.

The check must query the configuration used by the daemon or builder, not rely solely on client
environment text. A builder that cannot report or prove the policy is ineligible for release builds.

Ordinary derivations must not access the network. Network access is limited to:

- trusted binary-cache substitution outside derivation execution;
- fixed-output fetchers whose result is verified by a declared cryptographic hash;
- explicit deployment operations, which are not artifact builds.

`nix` itself may resolve from `/nix/var/nix/profiles/default/bin/nix` at the bootstrap boundary. This
exception does not apply to language tools, compilers, package managers, shells used by actions, or
artifact runtime commands.

## Buck Action Contract

Buck remains responsible for target discovery, dependency edges, scheduling, and action isolation.
Artifact rules declare every source, provider, lockfile, patch, toolchain, and generated input;
invoke Nix through the canonical helper; pass the immutable bundle; use store-qualified tools and
isolated home/temp roots; and avoid timestamps, random identifiers, branches, and user configuration.
Outputs belong only under Buck outputs or `/nix/store`. Stale generated input fails with the `u`
repair instruction.

Probe-only and orchestration rules remain explicitly classified and cannot publish production
artifacts. A new language needs bundle wiring, environment and sandbox coverage, and reproducibility
evidence before its artifact macros leave experimental status.

## Development Workflows

`d` continues to run the framework dev command with its working directory in the live importer.
Vite, Next, language servers, and WebAssembly watcher scripts continue to observe tracked and
untracked source changes. Nix provides tools and dependency closures; it does not replace the live
working tree used by the watcher.

When local `b` finds relevant untracked files, it automatically captures them in a filtered,
content-addressed development bundle before evaluation and labels the result non-release. New files
therefore work without `git add`, but cannot influence CI or release artifacts. Tracked modifications
are captured by either bundle; release policy may separately require a clean tracked worktree.

Target-discovery, lock, provider, or generated-config changes require `u` and a restart. Ordinary
edits under an existing importer remain eligible for hot reload.

## Verification Strategy

### Policy tests

- Local `b` selects a development bundle for relevant untracked files without using `--impure`.
- CI rejects relevant untracked input and `--impure` in every artifact-publication stage.
- Inventory failure, external symlinks, and ambiguous source ownership fail closed.
- Hermetic evaluation succeeds with all former selector environment variables unset.
- A hostile environment cannot change the selected compiler, interpreter, package manager, source,
  graph, lockfile, or output path.
- System, Homebrew, fake, and nested-lookalike tool paths are rejected or bypassed for store tools.

### Sandbox tests

- A canary derivation attempts to read a unique undeclared host file and must fail.
- A normal derivation attempts undeclared network access and must fail.
- A fixed-output fetcher with the correct hash succeeds; a content mismatch fails.
- Startup fails when sandboxing is disabled or fallback is enabled.

### Reproducibility tests

For representative Go, Node, Python, C++, WebAssembly, and mixed-language artifacts:

1. Create two clean checkouts at the same revision under different absolute paths.
2. Give them different `HOME`, `TMPDIR`, XDG paths, locale, timezone, and hostile `PATH` entries.
3. Build on independent builders for the same Nix system.
4. Assert identical derivation identities, output store paths, and NAR hashes.
5. Force a rebuild or Nix check-build and require byte-identical output.
6. Repeat warm and assert no new source or fixed-output store identity.

Every builder participating in the protected reproducibility lane must publish a small evidence
manifest containing the revision, bundle digest, system, derivation path, output path, and NAR hash.
The comparison excludes timestamps and machine identities. Ordinary local `b` emits policy evidence
but is not a substitute for this protected independent-builder manifest.

### Boundary tests

- `u` performs the required repair, while `i` and `b` reject the same stale state without mutation.
- Temp-repository builds use an explicit development bundle and clean all temporary roots.
- `d` observes edits and newly created files through a real hot-reload or watcher smoke test.
- Impure development outputs cannot enter release or binary-cache publication paths.
- Interrupted builds leave no owned descendant process, hidden capture inode, or temporary bundle.

All integration tests must follow the execution-time and disk-growth guardrails in
`../../docs/handbook/getting-started-on-a-pr.md`. Cold and warm evidence must attribute new Nix store
paths by role rather than relying only on total filesystem usage.

## Delivery Sequence

1. Add read-only inventory and evidence reporting for impurity, inherited environment, sandbox
   policy, builder policy, and representative artifact identities.
2. Introduce the immutable evaluation bundle and migrate full and selected graph evaluation.
3. Remove `builtins.getEnv` selectors and `--impure` from normal artifact materialization.
4. Add automatic local development bundles; make CI fail on relevant untracked input.
5. Apply the canonical environment allowlist to `b`, Buck, Nix, CI, and remote execution.
6. Enforce sandbox and network policy locally, in CI, and on remote builders.
7. Add independent-checkout, forced-rebuild, hostile-environment, and builder-parity gates.
8. Require the same contract in language onboarding docs, templates, and policy checks.

Each step must preserve the primary path and include focused regression evidence before broad
validation. Compatibility fallbacks that silently restore live paths, ambient tools, or impure
evaluation are forbidden.

## Acceptance Criteria

We may describe `b` as hermetic only when all of the following are true:

- Normal local and CI `b` contain no impure Nix evaluation.
- Local untracked input selects a labeled development bundle; the same input fails in CI/release.
- Evaluation has no ambient selector; tools and dependencies use reviewed store paths.
- Builders enforce sandboxing without fallback; derivations cannot read host files or use network.
- Independent same-system builders produce matching representative NAR hashes.
- `i` and `b` make no tracked changes; stale state directs the user to `u`.
- Hot reload and explicit development builds remain functional and separately classified.
- Cold and warm validation have bounded time/disk growth and stable source identities.
- The full `i && b && ALL_TESTS=1 v` checkpoint passes after focused hermeticity gates.

Until these criteria pass, documentation should say that artifacts are Nix-backed and increasingly
isolated, not that the complete `b` workflow is hermetic.
