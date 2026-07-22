# Artifact execution policy

This document describes the enforced execution boundary for Nix-backed artifacts. Release evidence
adds an independent-builder gate; passing local execution policy alone is not publication proof.

## Reproducibility and publication evidence

Bundle preparation records the full Git revision in the immutable evaluation bundle's canonical
`source-authority.json`; the evidence producer never consults live Git. Each matrix cell materializes
the unchanged bundle twice and requires the same source store root, bundle digest, and binding digest
before it can emit the single structured evaluation-bundle authority. For one artifact it also binds
the immutable source, graph, dependency/lock, tool closure,
Nix system, derivation, output, NAR, language family, target, checkout, and the sole builder
authority tuple (reviewed identity, policy, supported system, registry, policy assertion, and
probe flake). The matrix ID and artifact family come from the sole matrix authority in
`build-tools/tools/lib/artifact-reproducibility-matrix.ts`. The producer verifies the output with
Nix, forces a rebuild, and performs an unchanged warm build. Its matrix binding derives the target,
artifact family, and flake reference from the immutable evaluation bundle; callers cannot supply
those fields independently. The stored `run-record.json` binds the evidence to the exact reviewed
builder registry for aggregation. Artifact outputs are staged through the active reviewed remote
store authority into the registry-declared internal evidence store; this is not release publication.

The variable run observation starts before temp-consumer scaffolding. It times scaffolding, both
evaluation-bundle materializations, owned-root cleanup, initial build, forced rebuild, and warm
build in canonical order. Local and remote Nix inventories retain exact path and NAR-size deltas;
every new path must belong to the evaluation bundle, the isolated reviewed builder probes, or the
artifact derivation/output closure. The producer's lifecycle scope begins before registry
verification and the active remote smoke, takes the remote baseline before probes, and ends only
after the artifact output is copied to the reviewed evidence store. The observation retains each
managed command leader/process-group ID in that scope and requires descendant-group closure after
every command. Cleanup proof, canonical-environment store-qualified open/deleted-open file
inspection, and hidden-capture inspection must all close before aggregation. These host-variable
facts are signed observation evidence and never enter the compared artifact identity.

Observation finalization is explicitly non-circular. The content-addressed observation cannot attest
to its own `nix store add-path`, the later run-record registration that references it, the parent
batch copy, or its containing producer process. Observation v4 marks those bounded canonical
commands as post-finalization or self-containing instead of claiming they were observed. Aggregate
admission independently validates the resulting immutable observation and run-record store paths.

The comparator accepts exactly two records from distinct checkout and builder identities on the same
Nix system. Every artifact identity field must match. The aggregator requires the complete canonical
6-by-3 matrix plus every declared production publication subject and emits one canonical
`aggregate.json`; extra or missing entries fail closed.
Matrix cells upload unsigned content-addressed run-record, observation, and artifact-output roots and
never receive a private key. The protected aggregate stage permits unsigned ingestion only for the
exact stashed roots, fully validates the fixed record set and each output's derivation, NAR, and
recursive closure identity, then uses its fixed Jenkins credential to sign records, observations,
and complete accepted output closures. It republishes and performs signed readback before signing
the aggregate. Generic evidence-store ingestion is not a trust or signature authority.
Protected consumers accept only its immutable Nix store reference. They verify the aggregate and its
referenced reviewed-builder registry with `nix store verify --sigs-needed 1`, trusting only the
dedicated `main` evidence public key. The signing key remains external mode-0600 administrator state
and must never enter the store, workspace, generated command, or logs.

Cache publication accepts the complete signed aggregate, selects only its production publication
comparisons for the manifest's Nix system, and fetches those roots from the registry-declared
reviewed evidence store. Matrix comparisons qualify the build families but are never publication
authority. The publisher sends only the selected publication roots and the signed aggregate root;
Nix closure traversal
may include dependencies below a proven root, but a manifest cannot introduce an unrelated
publication root. Default graph, toolchain, wheelhouse, or caller-selected roots are not supplemental
proof under this gate. A handwritten attestation, local-development bundle, successful build,
embedded comparison, or caller signature claim is insufficient. Hermetic deployment provenance uses
`viberoots.hermetic-artifact.v1`. The `deployment-publication-evidence` app creates the external
selection containing only an untrusted credential-free evidence-store locator, the signed aggregate
store path, and one publication output path. Admission copies from the candidate, verifies the
aggregate and registry, and accepts it only when the candidate exactly matches the signed store URI.
Admission, replay, and promotion first stage and reverify the aggregate and registry, use the signed
registry's credential-free store URI as the sole evidence endpoint, stage the selected output, and derive its two
builders, signature status, and static-webapp artifact identity from signed material. The selected
output must be a production publication comparison authorized for the deployment component; caller
claims and matrix comparisons are not accepted.

Back out a failing publication by disabling the publishing job, retaining both builder records and
outputs, and correcting the declared input or builder authority. Do not publish one builder's output,
rewrite the evidence, reuse evidence across systems, or weaken the comparison.

## Environment modes

Artifact commands use one environment authority with local, CI, and remote modes. All modes:

- use the exact `PATH` from the generated, reviewed artifact-tool closure;
- use isolated `HOME`, `TMPDIR`, and XDG directories below Buck temporary output;
- set `LANG=C.UTF-8`, `LC_ALL=C.UTF-8`, `TZ=UTC`, and `SOURCE_DATE_EPOCH=1`;
- omit compiler, linker, language search-path, package-manager home, user config, and Node injection
  variables;
- construct `NIX_REMOTE=daemon` and certificate paths from the reviewed artifact-tool closure rather
  than forwarding ambient store or trust authorities;
- pass only reviewed Buck isolation and viberoots orchestration transport variables.

The remote mode has the smallest transport surface. It also omits terminal and client certificate
inheritance. Artifact selectors belong in the immutable evaluation bundle. A local invocation with
an ambient graph, target, target platform, target attribute, query-root, Node injection option,
legacy lock selector, or `NIX_PATH` fails with a diagnostic to
remove the variable and declare the value in the bundle.

The `d` command is not an artifact environment. It retains its live working directory, watcher
state, and framework-specific development environment. Those values are not forwarded when `d` or
another orchestrator starts an artifact build.

## Tool authority

The Buck and Nix child boundaries resolve required tools from one generated artifact-tool closure
in `/nix/store`; another store path is not an interchangeable authority. The sole bootstrap
exception is Nix at `/nix/var/nix/profiles/default/bin/nix`. Buck artifact actions run a common
preflight before reading the workspace or invoking Nix; it rejects a shell, copy tool, language
runtime, or helper that resolves outside `/nix/store`.

Artifact actions declare their source, lock, provider, patch, generated, graph, and bundle inputs
through their owning macro. The shared action runner requires an explicit declared-input list.
Orchestration and probe actions carry a non-publishable classification rather than presenting their
outputs as production artifacts.

## Nix policy

Every artifact Nix command applies the same requested policy and rejects Nix diagnostics that any
restricted setting was ignored. The local sandbox canary independently verifies the active daemon's
host-file and network denial behavior at the validation checkpoint. The inspected command policy
requires:

- sandboxing is enabled;
- sandbox fallback is disabled;
- requested `sandbox-paths` and `extra-sandbox-paths` are both empty, and Nix's merged effective
  `sandbox-paths` value is empty;
- local artifact builds disable ambient remote builders;
- substituters and public keys match the reviewed authority;
- the active store reports the multi-user daemon boundary.

Missing or unreadable policy evidence fails closed. So do host tools, unreviewed caches or keys,
configured host paths, direct-store execution, and protected non-hermetic classifications. Remote
builders require their existing typed builder and smoke evidence before they become eligible; local
artifact policy never inherits an unreviewed machine file.

To repair a rejected machine, update the reviewed Nix daemon or builder configuration and re-enter
the dev shell. Do not add a client environment override or host-path exception.

On Darwin, the standard Nix stdenv platform trust base still declares the operating-system paths
required to start sandboxed processes (for example the system runtime loader and entropy devices).
Viberoots adds no custom `sandboxProfile` or `__impureHostDeps`; tests inspect representative
derivations against that reviewed platform trust base. "No host-path exceptions" in this policy
means no viberoots-added or user-configured exception beyond Nix's platform stdenv.

## Network boundary

Ordinary derivations run under the fixed sandbox policy and cannot use the host network. Network
access is limited to binary-cache substitution outside derivation execution and reviewed
fixed-output fetchers with declared hashes. Cache reachability probes do not run from Buck artifact
actions and cannot rewrite `NIX_CONFIG` during artifact construction. Deployment networking remains
an explicit non-build operation.

The structural policy test inventories public artifact macros from their real `defs.bzl` exports,
checks the documented route classification, rejects direct executor bypasses, and limits reviewed
Nix network sources to fixed-output forms. Runtime tests use hostile environment and tool paths,
sandbox host-file/network canaries, and correct/incorrect fixed-output hashes.
