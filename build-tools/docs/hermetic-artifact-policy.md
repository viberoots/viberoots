# Artifact execution policy

This document describes the enforced execution boundary for Nix-backed artifacts. It does not make
the complete hermetic-build claim; independent-builder reproducibility and publication evidence are
separate gates.

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
- host sandbox paths are empty;
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
