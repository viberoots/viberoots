# CI Handbook

CI runs zx-backed stages and does not commit generated glue.

## Stages (via viberoots/build-tools/tools/ci/run-stage.sh)

1. `export-graph`
2. `sync-providers` (unified orchestrator; per-language drivers run conditionally)
3. `gen-auto-map`
4. `prebuild-guard`
5. `nix-build-graph-generator` (optional)
6. `wheelhouse-preload` (Python; optional cache push)
7. `buck-test`
8. `cpp-addon-smoke`

Run locally with `CI=true viberoots/build-tools/tools/ci/run-stage.sh --stage <name>`.

CI and local wrappers use the same default Nix cache policy as developer commands:
`VBR_NIX_CACHE_POLICY=auto` probes configured HTTP(S) substituters, disables unreachable configured
caches for the current process, keeps Nix fallback enabled, and continues locally. Use
`VBR_NIX_CACHE_POLICY=strict` only for cache-readiness lanes where cache reachability is the tested
behavior; use `VBR_NIX_CACHE_POLICY=off` only to skip the dynamic probe.

## What each stage does (simple)

- **export-graph**: Freeze the configured Buck graph to `.viberoots/workspace/buck/graph.json` so other steps read a stable view.
- **sync-providers**: Unified orchestrator regenerates language providers and `.viberoots/workspace/providers/nix_attr_map.bzl` deterministically (Node is skipped when no PNPM lockfiles are present).
  - Provider naming is canonical and shared across languages via `build-tools/tools/lib/providers.ts`. Do not handcraft provider labels in docs or examples; prefer helpers: `providerNameForModuleKey`, `providerNameForImporter`.
- **gen-auto-map**: Map targets → providers based on labels in the exported graph; keeps invalidation tight.
- **prebuild-guard**: Ensure glue exists and is fresh. Locally it can auto‑fix; CI fails fast with clear errors.
  - Reference: `docs/handbook/troubleshooting.md#prebuild-guard-glue-presence--freshness`.
- **nix-build-graph-generator**: Build artifacts via Nix templates, warming the Nix store for the matrix.
- **wheelhouse-preload**: Without `--to`, builds Python wheelhouse outputs (`py-wheelhouse-*`) for
  importers with `uv.lock`. Protected publication supplies `--to`, an untrusted credential-free
  `--evidence-store-locator`, and the immutable signed `--reproducibility-aggregate`; that path publishes only the aggregate's production publication
  outputs for the current Nix system instead of treating matrix cases or discovered wheelhouses as
  reviewed release roots.
  - Safe no-op when no Python importers exist.
- **buck-test**: Resolves the same requested scope as local `v`, then runs the selected Buck tests through verify target-pass planning. Documentation-only changes are not treated as build-system changes just because they live under `build-tools/**`; reviewed deployment/operator docs use their compact documentation contract bucket. Coverage mode still flows through `COVERAGE=1`; CI defaults remain local unless a future lane explicitly provides remote verify policy env.
- **cpp-addon-smoke**: Explicitly local-only direct Buck smoke stage for the temporary scaffold workspace. It scrubs broad `VBR_REMOTE_*` policy env before invoking Buck because the temp workspace does not yet carry the remote execution policy contract.

## Why keep a Nix build stage separate from Buck

- **Isolation**: If Nix templates or patch maps break, the failure shows up here with focused logs.
- **Caching**: Warms Nix outputs per architecture; Buck jobs mostly hit cache instead of re‑discovering derivations.
- **Signal**: Clear blame lines—if Nix is green but Buck fails, look at provider wiring/macros or test logic.

Locally you can use Buck alone. CI splits stages for speed and diagnostics across architectures.

## Protected artifact reproducibility gate

The ordinary CI matrix does not claim artifact reproducibility. The protected lane exists only when
`VBR_PROTECTED_REPRODUCIBILITY=1` and requires these reviewed inputs:

- `VBR_REPRODUCIBILITY_REGISTRY_STORE_PATH`: the signed immutable `registry.json`;
- `VBR_REPRODUCIBILITY_TRANSPORT_ROOT`: owner-controlled mode-0600 SSH transport files, arranged by
  system and reviewed builder identity;
- `VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS`: the immutable remote worker tool closure;
- `VBR_REPRODUCIBILITY_BUILDER_POLICY`: `inherit_config` or `force_builders_file`;
- Jenkins file credential
  `secret://ci/hermetic-builds/reproducibility/evidence-store-aws-shared-credentials`: the existing
  SprinkleRef identity for an ephemeral owner/nofollow/mode-0600 AWS shared-credentials file.

The signed registry v3 binds the sole credential-free reviewed evidence-store URI. Configuration
management must pre-provision that exact signed registry root on every matrix and aggregate agent;
the registry is the sole store authority, so there is no second environment-selected URI from which
to bootstrap it. The aggregate stage uses the fixed Jenkins file credential
`secret://ci/hermetic-builds/reproducibility/evidence-signing-key`; the external nofollow mode-0600 key is never read into
memory, copied to the store, or selected by an environment-provided credential ID.
The credentials file contains no endpoint and is injected only into bounded evidence-store
`nix copy --to` children; ambient AWS variables are scrubbed and instance-metadata credentials are
disabled. Jenkins materialization is delivery only; the `secret://...` SprinkleRef remains the sole
logical secret identity and Jenkins does not implement another resolver.

Jenkins runs every committed reproducibility matrix case in isolated workspaces for two distinct
registered daemon authorities on each release Nix system. Registry parsing rejects identities that
alias the same connection endpoint or SSH host key. The two checkout slots deliberately receive different
`HOME`, `TMPDIR`, XDG roots, locale, timezone, and hostile `PATH` prefixes; canonical store-qualified
artifact ingress removes those host inputs. Each cell materializes its hermetic evaluation bundle
twice and requires an identical source root, bundle digest, and binding before running the initial,
forced-rebuild, and warm checks through the same active reviewed remote-builder authority. The
immutable bundle is the sole source-revision authority. Cells receive no signing key and upload
unsigned, content-addressed run-record, observation, and artifact-output roots to the internal
evidence store. The protected aggregate stage uses `--no-check-sigs` only to ingest the exact roots
named by the six stashed cell manifests, rejects any missing, extra, duplicate, cross-revision,
cross-registry, cross-system, builder, checkout, subject, or complete artifact-identity mismatch,
and checks every hydrated output's derivation, NAR, and recursive closure identity. Only then does
the aggregate credential sign every accepted record and observation plus each accepted artifact
output's complete closure. It republishes and performs signature-checking readback before signing,
verifying, and publishing the aggregate containing the fixed 18 matrix comparisons and the
production publication comparisons. Generic Nix store ingestion is not treated as trust authority.

Protected cache publication is constrained to output roots named by the signed aggregate. Dependency
closures may follow an evidenced root, but an unrelated requested root is not supplemental evidence
and must be rejected. The publisher accepts the complete signed aggregate, selects only its
production publication comparisons for the current system, and stages them from the
registry-declared evidence store before publishing those roots and the aggregate root. Fresh workers
use the untrusted locator only to copy the aggregate, verify it with the dedicated evidence key,
derive and copy the referenced registry, verify that root, and require its signed `storeUri` to equal
the locator before accepting either JSON document or staging the selected output. Adding a publication root
therefore requires changing and rerunning the production publication-subject authority rather than
supplying an unsigned comparison or arbitrary CLI target.

Deployment workflows create the external selection with the `deployment-publication-evidence` Nix
app. The selection contains only the untrusted credential-free locator, signed aggregate store path,
and one aggregate-bound publication output path. Admission derives builders and signature status from the signed comparison, stages the
output, maps its `dist` directory through the canonical static-webapp identity function, and requires
the signed publication subject to authorize the exact deployment component. Callers cannot provide
builder, status, signature, locator, or ambient cache claims.
