# Build Input Archive Design

Status: design note, not an active operator runbook. It describes the intended build-input archive
mechanism and should be checked against current implementation before use.

## Purpose

This document describes the implementation needed to make future offline rebuilds possible for this repository from archived build inputs. The mechanism must support one or more Buck2 target patterns, one or more canonical project roots, and the recursive dependency closure of one or more projects.

The archive is a rebuild capsule: reviewed source, generated build metadata, Nix flake inputs, language dependency materializations, Nix store closures, provenance, and restore instructions. A compatible fresh machine with the archive and baseline tooling must be able to rebuild the selected scope without internet access.

## Bootstrap Boundary

The archive should minimize host assumptions, but it cannot bootstrap Nix itself. A restore host is expected to provide:

- A compatible Nix installation with `nix-command` and `flakes`.
- Archive tooling needed to unpack the bundle, such as `tar` and `zstd`, unless the archive is delivered expanded.
- A POSIX shell for the generated restore script.

Buck2, Node, PNPM, Python, Go, C++ toolchains, and repo-specific scripts should come from archived Nix closures wherever practical. If any restore step uses host-provided tooling beyond Nix and unpack tools, the manifest must record that assumption and verification must exercise it.

## Self-Review Corrections

This version incorporates a self-review of the initial design:

- Do not combine `nix build --offline` with a `file://` binary-cache substituter. Nix's `--offline` disables substituters. Restore must either import the closure into the local store and then use `--offline`, or use archive-local `file://` substituters with network blocked and without `--offline`.
- Distinguish offline substitution from true offline rebuild. Substituting final outputs proves the archive can restore outputs, not that it can re-execute the build from archived source inputs.
- Make target and project resolution explicit enough to implement without ad hoc `cquery` string construction.
- Treat generated glue as a first-class archive component because this repo intentionally has generated build metadata that is not always committed.
- Treat Rust as unsupported for real archive semantics until real Cargo/Nix dependency materialization exists.
- Include flake input paths in every restore mode. If flake inputs live in a separate cache, restore must configure that cache too; if raw store export is used, flake input paths must be included in the raw closure.
- Record cache signing/trust in the manifest so restore cannot silently fall back to untrusted or network substituters.
- Build commands must be system-aware. `.#graph-generator-selected` means the current system; multi-system archives must build explicit `.#packages.<system>.graph-generator-selected` attrs or run on workers whose `builtins.currentSystem` matches the requested system.
- True rebuild verification needs more than final output closures. It needs derivations, fixed-output source fetcher outputs, language dependency materializations, and toolchains while deliberately withholding selected final outputs.

## Verified External Contracts

The design relies on upstream behavior verified against live documentation on May 27, 2026:

- Buck2 target patterns are accepted by build and query commands. `//pkg:target` selects one target, `//pkg:` selects all targets in one package, and `//pkg/...` recursively selects targets in a subtree. See <https://buck2.build/docs/concepts/target_pattern/>.
- `buck2 build` accepts target patterns and can print output paths with `--show-output`, `--show-full-output`, and JSON variants. See <https://buck2.build/docs/users/commands/build/>.
- Buck2 `cquery` operates on the configured target graph and supports target expressions and dependency queries. See <https://buck2.build/docs/users/commands/cquery/> and <https://buck2.build/docs/users/query/cquery/>.
- `nix copy --to file://...` writes store paths and their closures to a local binary cache. See <https://nix.dev/manual/nix/stable/command-ref/new-cli/nix3-copy>.
- `nix flake archive --to file://...` copies a flake and its inputs to a store or binary cache. See <https://nix.dev/manual/nix/2.18/command-ref/new-cli/nix3-flake-archive>.
- `nix path-info --recursive --json --closure-size` reports store-path closure metadata after paths are built or substituted. See <https://nix.dev/manual/nix/stable/command-ref/new-cli/nix3-path-info>.
- `nix build --offline` disables substituters and considers previously downloaded files up to date. Use it only after required store paths have been imported into the local store. See <https://nix.dev/manual/nix/stable/command-ref/new-cli/nix3-build>.
- `nix-store --export $(nix-store -qR ...)` and `nix-store --import` remain valid raw closure transport primitives, but a Nix binary cache is the preferred archive format.
- PNPM's `pnpm install --offline` installs only from the local store. See <https://pnpm.io/cli/install>.
- Go modules use `GOMODCACHE`; if module data is missing, the go command fetches through `GOPROXY` or direct VCS according to module settings. See <https://go.dev/ref/mod>.
- uv has an append-only global cache and offline operations read from cache. See <https://docs.astral.sh/uv/concepts/cache/>.

## Current Repo Facts

- Buck2 is the selector and graph source of truth. Nix is the artifact-producing build layer.
- `build-tools/tools/dev/build-selected.ts` builds one selected target by requiring `BUCK_TARGET`, ensuring `build-tools/tools/buck/graph.json`, clearing dev override envs, and running `nix build --impure ... .#graph-generator-selected`.
- `build-tools/tools/dev/filtered-flake.ts` already creates filtered `path:` flake snapshots that exclude `node_modules`, `buck-out`, `.direnv`, cache directories, and result symlinks. Archive creation should reuse or extract this filtering contract instead of inventing a second source filter.
- `build-tools/tools/nix/graph-generator.nix` resolves `BUCK_TARGET` against graph nodes and dispatches to Go, Node, Python, C++, or Rust planners.
- `build-tools/tools/buck/glue-pipeline.ts` centralizes generated build metadata: importer roots, graph export, Node lock sidecar index, provider sync, provider index, `third_party/providers/auto_map.bzl`, workspace map, and invalidation report.
- `build-tools/tools/lib/project-closure-selector.ts` already resolves canonical project roots to `//<project>/...` target patterns for the project's dependency closure.
- `build-tools/tools/nix/flake/packages/default.nix` exports relevant package attrs, including `graph-generator`, `graph-generator-selected`, `graph-generator-pure`, `graph-generator-pure-selected`, `buck-graph`, `test-seed`, `node-modules`, `pnpm-store`, Python wheelhouse outputs, `toolchains`, and deployment outputs across `aarch64-darwin`, `aarch64-linux`, and `x86_64-linux`.
- `build-tools/tools/dev/install/common.ts` owns importer-to-attr helpers for `pnpm-store.<sanitized-importer>` and `node-modules.<sanitized-importer>`. Archive code should reuse those helpers, not duplicate sanitization.
- Deployment tooling already has digest-addressed artifact storage and provenance-aware records. Current artifact-store payload kinds are `artifact` and `execution-snapshot`, so build-input archive promotion requires extending that type surface rather than only passing a new string at call sites.

The missing product is an end-to-end archive command that resolves a requested Buck selector or project set, materializes required Nix outputs, captures exact source and generated glue, copies required Nix closures, emits a versioned manifest, and proves the archive in a network-disabled fresh workspace and store policy.

## Goals

- Support `--target` / `--targets` with Buck2 target patterns.
- Support `--project` / `--projects` with canonical repo-relative project roots.
- Support `--selector project-closure` for project dependency closure archives.
- Archive one or more systems. The default is `builtins.currentSystem`; CI can request `aarch64-darwin`, `aarch64-linux`, and `x86_64-linux` when local or remote builders for those systems are configured. Cross-system requests must fail clearly if the current environment cannot realize the requested system's store paths.
- Prefer Nix binary-cache archives over raw `nix-store --export` blobs.
- Make the archive content-addressed and self-describing.
- Fail closed on dev overrides, dirty protected source, stale generated glue, missing lockfiles, missing store paths, unknown target kinds, mutable source refs in protected mode, or failed verification.
- Keep restore logic deterministic and scriptable.

## Non-Goals

- Do not invent a second build system.
- Do not vendor all third-party source into `third_party/` as the primary mechanism.
- Do not claim cross-time bit-for-bit reproducibility across future OS/kernel/tool versions unless the archive also preserves the execution environment.
- Do not make Buck2 remote execution part of the first milestone.
- Do not proxy Nix cache or build traffic through application auth services. The archive may be uploaded through the existing artifact store, but Nix substitution must remain Nix-native.

## Archive Format

```text
build-input-archive/
  manifest.json
  manifest.sha256
  source/
    repo.tar.zst
    repo-tree.sha256
    generated-overlay.tar.zst
    git.patch.optional
  generated/
    graph.json
    graph.sha256
    node-lock-index.json
    selection.json
    auto_map.bzl
    provider_index.json
    provider_index.bzl
    workspace-map.json
    invalidation-report.txt
    importer-roots.bzl
    langs.json
  nix/
    binary-cache/
      nix-cache-info
      *.narinfo
      nar/*
    flake-archive/
      ...
    flake-archive.json
    store-paths.txt
    final-output-paths.txt
    support-output-paths.txt
    flake-input-paths.txt
    derivation-paths.txt
    source-support-paths.txt
    closure-info.json
    raw-store-closure.nar.optional
  language/
    node/
      importers.json
      pnpm-store-paths.json
      node-modules-paths.json
    go/
      modules-toml.json
    python/
      wheelhouse-paths.json
      uv-locks.json
    cpp/
      nix-attrs.json
    rust/
      status.json
  verification/
    restore-script.sh
    substitute-verify-log.txt
    import-offline-verify-log.optional.txt
    rebuild-verify-log.optional.txt
    offline-result-paths.json
    verify-report.json
```

The tarball name should include the manifest digest:

```text
viberoots-build-input-archive-${manifestDigest}.tar.zst
```

The payload should also be uploadable to the existing control-plane artifact store using object kind `build-input-archive`. The artifact identity should be derived from the manifest digest, not a mutable branch or user-supplied name.

## Manifest Schema

Use a versioned schema:

```json
{
  "schema": "build-input-archive@1",
  "createdAt": "2026-05-27T00:00:00.000Z",
  "repo": {
    "sourceRevision": "commit:<40hex>",
    "dirtyMode": "reject|include-uncommitted-patch",
    "sourceArchiveDigest": "sha256:<hex>",
    "repoTreeDigest": "sha256:<hex>",
    "generatedOverlayDigest": "sha256:<hex>",
    "flakeLockDigest": "sha256:<hex>",
    "flakeNixDigest": "sha256:<hex>"
  },
  "request": {
    "mode": "buck-patterns|projects|project-closure",
    "buckPatterns": ["//projects/apps/sample-webapp/..."],
    "projects": ["projects/apps/sample-webapp"],
    "systems": ["aarch64-darwin"]
  },
  "selection": {
    "configuredTargets": [
      {
        "label": "//projects/apps/sample-webapp:sample-webapp",
        "configuration": "prelude//platforms:default",
        "language": "node",
        "kind": "webapp",
        "package": "projects/apps/sample-webapp",
        "artifactProducing": true
      }
    ],
    "graphDigest": "sha256:<hex>",
    "generatedGlueDigest": "sha256:<hex>"
  },
  "nix": {
    "nixVersion": "2.x",
    "experimentalFeatures": ["nix-command", "flakes"],
    "cachePath": "nix/binary-cache",
    "cacheMode": "binary-cache|raw-store-export|both",
    "flakeArchiveMode": "separate-cache|merged-into-binary-cache",
    "flakeArchivePath": "nix/flake-archive",
    "flakeArchiveJsonDigest": "sha256:<hex>",
    "cacheTrust": {
      "signed": false,
      "publicKeys": []
    },
    "finalOutputPaths": ["/nix/store/..."],
    "supportOutputPaths": ["/nix/store/..."],
    "flakeInputPaths": ["/nix/store/..."],
    "derivationPaths": ["/nix/store/...drv"],
    "sourceSupportPaths": ["/nix/store/..."],
    "closureDigest": "sha256:<hex>",
    "narinfoDigests": ["sha256:<hex>"]
  },
  "language": {
    "node": {
      "importers": [
        {
          "importer": "projects/apps/sample-webapp",
          "lockfile": "projects/apps/sample-webapp/pnpm-lock.yaml",
          "lockfileDigest": "sha256:<hex>",
          "pnpmStoreOutput": "/nix/store/...",
          "nodeModulesOutput": "/nix/store/..."
        }
      ]
    },
    "go": {
      "modulesToml": [
        {
          "path": "gomod2nix.toml",
          "digest": "sha256:<hex>"
        }
      ]
    },
    "python": {
      "uvLocks": [],
      "wheelhouses": []
    },
    "cpp": {
      "nixAttrs": ["pkgs.openssl", "pkgs.zlib"],
      "overlayMode": "disabled|enabled"
    },
    "rust": {
      "status": "unsupported-real-cargo-archive"
    }
  },
  "verification": {
    "substituteVerified": true,
    "importOfflineVerified": false,
    "rebuildVerified": false,
    "verifiedAt": "2026-05-27T00:00:00.000Z",
    "commands": ["..."],
    "resultPaths": ["/nix/store/..."]
  }
}
```

Canonicalize JSON before hashing:

- Sort object keys.
- Sort lists when list order is not semantically meaningful.
- Preserve ordered input lists when order is part of the contract.
- Normalize paths to repo-relative POSIX paths or absolute Nix store paths.

`buildInputsFingerprint` should be `sha256(canonical manifest without verification fields plus source archive digest, repo tree digest, generated glue digest, flake archive metadata digest, language input digests, Nix input digests, and closure-info digest)`. Deployment evidence can then bind this fingerprint to `sourceRevision` and final artifact identity.

`manifest.sha256` must avoid self-reference. Compute it from canonical `manifest.json` with mutable verification log locations and any `manifestDigest` field omitted. Verification booleans and result paths may be included only after archive creation; if they are updated after a verification run, write a new manifest digest and keep the prior manifest as provenance. `buildInputsFingerprint` should be stable across verification reruns, so it must exclude `verification.*` fields and include only source, selection, generated glue, language inputs, Nix inputs, and closure metadata.

## New CLI

Add:

```text
build-tools/tools/dev/archive-build-inputs.ts
build-tools/tools/bin/archive-build-inputs
build-tools/tools/dev/restore-build-archive.ts
build-tools/tools/bin/restore-build-archive
```

`archive-build-inputs.ts` and `restore-build-archive.ts` must be TypeScript zx scripts with the repo hashbang `#!/usr/bin/env zx-wrapper`. Any `build-tools/tools/bin/*` wrapper must stay a thin delegating shim, consistent with `build-tools/docs/build-system-design.md`.

Keep implementation modules single-purpose and under the repo's 250-line file guardrail. Split archive work into small modules for manifest canonicalization, target selection, source snapshotting, Nix command execution, closure export, language metadata, restore, and verification rather than placing substantive logic in the CLI entrypoints.

Supported options:

```text
archive-build-inputs --target //projects/apps/sample-webapp:sample-webapp
archive-build-inputs --targets //projects/apps/sample-webapp/... //projects/libs/shared-ui/...
archive-build-inputs --project projects/apps/sample-webapp
archive-build-inputs --projects projects/apps/sample-webapp,projects/libs/shared-ui
archive-build-inputs --selector project-closure --project projects/apps/sample-webapp
archive-build-inputs --system aarch64-darwin --system x86_64-linux
archive-build-inputs --out buck-out/archives/sample-webapp
archive-build-inputs --to file:///tmp/viberoots-build-cache
archive-build-inputs --verify=substitute
archive-build-inputs --verify=import-offline
archive-build-inputs --verify=rebuild
archive-build-inputs --upload-control-plane
```

Guardrails:

- Exactly one of target mode or project mode must be selected.
- `--selector project-closure` requires `--project` or `--projects`.
- Protected/CI mode rejects dirty source unless `--include-uncommitted-patch` is explicitly allowed for local-only archives.
- Protected/CI mode rejects all dev override envs from the central override manifest via `allDevOverrideEnvNames()`, including `NIX_GO_DEV_OVERRIDE_JSON`, `NIX_CPP_DEV_OVERRIDE_JSON`, and `NIX_PY_DEV_OVERRIDE_JSON`.

## Target Resolution

Implement `build-tools/tools/dev/build-archive/selection.ts`.

For Buck patterns:

1. Normalize path-like arguments with `resolveSelectedTargetLabel` and the shared label helpers where possible.
2. Ask Buck2 to resolve target patterns into concrete configured targets. Prefer a repo helper that shells out in one place and is covered by tests.
3. If using `buck2 cquery`, construct the target expression explicitly and pass an appropriate target universe for recursive patterns.
4. Produce canonical configured target labels plus configuration/platform metadata.
5. Annotate target language and kind from exported graph labels and planner dispatch.
6. Classify targets:
   - Artifact-producing targets must be built and archived.
   - Test targets are included only when explicitly requested or when `--include-tests` is provided.
   - Probe-only targets are included in graph metadata but do not require an artifact output unless their planner emits one.

For projects, validate canonical project paths with `projectFromPackagePath`, translate to `//<project>/...`, and resolve with the same Buck pattern path.

For project closure, ensure graph is exported, call `resolveProjectClosureSelection`, then resolve returned target patterns into concrete configured targets.

Selection output should be stored as `generated/selection.json` and included in `manifest.json`.

## Build and Store Capture Pipeline

### Phase 1: Preflight

- Confirm Nix supports `nix-command` and `flakes`.
- Confirm Buck2 is available or can be invoked through the flake wrapper.
- Confirm protected mode has a clean git worktree and a commit SHA.
- Confirm local dirty mode is explicit and recorded.
- Confirm `flake.lock` is present.
- Confirm lockfiles are present for selected importers: `pnpm-lock.yaml`, nearest `gomod2nix.toml`, and `uv.lock`.
- Confirm generated glue is clean or will be regenerated deterministically.
- Confirm no unsupported Rust real-build targets are selected.

### Phase 2: Glue

Run:

```bash
build-tools/tools/dev/install-deps.ts --glue-only
```

Archive these generated files:

- `build-tools/tools/buck/graph.json`
- `build-tools/tools/buck/node-lock-index.json`
- `third_party/providers/auto_map.bzl`
- `third_party/providers/provider_index.json`
- `third_party/providers/provider_index.bzl`
- `build-tools/tools/node/workspace-map.json`
- `build-tools/tools/buck/invalidation-report.txt`
- `build-tools/lang/importer_roots.bzl`
- `build-tools/tools/nix/langs.json`
- Any generated Nix attr aliases or provider stamps used by the selected graph.

Protected mode must fail if rerunning glue changes tracked files. Local mode may include generated changes in the overlay, but must record that generated state was refreshed.

All later build and archive phases should run against the normalized archive source workspace, not an ambient checkout. That workspace is reviewed source plus generated overlay in protected mode, and reviewed source plus generated overlay plus explicit patch overlay in local dirty mode. This keeps the built store paths, flake archive, source tarball, and manifest bound to the same source tree.

### Phase 3: Build Selected Outputs

For each selected configured target, run:

```bash
BUCK_TARGET='//projects/apps/sample-webapp:sample-webapp' \
BUCK_GRAPH_JSON="$PWD/build-tools/tools/buck/graph.json" \
WORKSPACE_ROOT="$PWD" \
nix build --impure --no-write-lock-file --option eval-cache false \
  --accept-flake-config --no-link --print-out-paths \
  "path:$PWD#graph-generator-selected"
```

The archive CLI should call a shared helper modeled on `build-selected.ts`, but with output capture and archive metadata instead of terminal-only output. It must preserve the existing dev-override scrubbing behavior and use a filtered `path:` flake source for the normalized archive workspace. Record printed output paths in `nix/final-output-paths.txt`. The shorthand attr above is only for the current system. For multi-system archives, run the equivalent per-system attr, for example:

```bash
nix build --impure --accept-flake-config --no-link --print-out-paths \
  "path:$PWD#packages.x86_64-linux.graph-generator-selected"
```

or execute the same current-system command on a worker whose `builtins.currentSystem` is the requested system. The manifest must record which mode was used. For broad archives, also build `path:$PWD#graph-generator` / `path:$PWD#packages.<system>.graph-generator` or `path:$PWD#graph-generator-pure` / `path:$PWD#packages.<system>.graph-generator-pure` with the selected graph. Every archive-owned Nix build command must use `--no-link --print-out-paths`; do not create or rely on `result` symlinks as archive roots.

### Phase 4: Build Support Outputs

Record support paths in `nix/support-output-paths.txt`:

- `.#buck2-prelude`
- `.#zx-wrapper`
- `.#test-seed` when tests or test restore verification are requested.
- `.#toolchains.go`, `.#toolchains.cxx`, `.#toolchains.emscripten`, `.#toolchains.tinygo`, `.#toolchains.python`, or `.#toolchains.opentofu` as needed by selected languages and deployment paths.
- `.#pnpm-store.<sanitized-importer>` and `.#node-modules.<sanitized-importer>` for selected Node importers, with attr names produced by `pnpmStoreAttr` and `nodeModulesAttr`.
- `.#py-wheelhouse-<sanitized-importer>` outputs for selected Python importers.
- `.#graph-generator-pure-selected` for each selected target if pure selected rebuild is part of verification.

### Phase 5: Flake Input Archive

Run:

```bash
nix flake archive --to "file://$ARCHIVE_DIR/nix/flake-archive" "$PWD"
nix flake archive --json --dry-run "$PWD" > "$ARCHIVE_DIR/nix/flake-archive.json"
```

Run this from the normalized archive source workspace, not from an ambient dirty checkout. In protected mode that workspace is the reviewed source plus the generated overlay; in local dirty mode it is reviewed source plus generated overlay plus the explicit patch overlay. Record flake input store paths in `nix/flake-input-paths.txt` and `nix.flakeInputPaths`.
Record the digest of `nix/flake-archive.json` in `nix.flakeArchiveJsonDigest`.

Restore must either configure both archive-local caches:

```text
substituters = file:///abs/archive/nix/binary-cache file:///abs/archive/nix/flake-archive
```

or write flake input paths into the same `nix/binary-cache` used for build closures. The manifest must record the chosen mode.

### Phase 6: Binary Cache Export

Write final and support output paths to `nix/store-paths.txt`, then copy closures:

```bash
nix copy --to "file://$ARCHIVE_DIR/nix/binary-cache" $(cat "$ARCHIVE_DIR/nix/store-paths.txt")
```

If `flakeArchiveMode` is `merged-into-binary-cache`, also copy the flake input paths into the same binary cache:

```bash
nix copy --to "file://$ARCHIVE_DIR/nix/binary-cache" $(cat "$ARCHIVE_DIR/nix/flake-input-paths.txt")
```

If `flakeArchiveMode` is `separate-cache`, restore must configure both the build binary cache and `nix/flake-archive`.

Record closure metadata for build roots and flake inputs:

```bash
nix path-info --recursive --json --closure-size \
  $(cat "$ARCHIVE_DIR/nix/store-paths.txt") \
  $(cat "$ARCHIVE_DIR/nix/flake-input-paths.txt") \
  > "$ARCHIVE_DIR/nix/closure-info.json"
```

Also record derivation paths and source/support paths needed by rebuild verification:

```bash
nix-store --query --deriver $(cat "$ARCHIVE_DIR/nix/final-output-paths.txt") \
  > "$ARCHIVE_DIR/nix/derivation-paths.txt"
```

`source-support-paths.txt` should contain fixed-output source fetcher outputs, flake input paths, language dependency materializations, and toolchain/support outputs. When rebuild verification is requested, copy the closure of those source/support paths:

```bash
nix copy --to "file://$ARCHIVE_DIR/nix/binary-cache" \
  $(nix-store -qR $(cat "$ARCHIVE_DIR/nix/source-support-paths.txt"))
```

When rebuild verification is requested, selected final output paths must not be used as cache roots for the rebuild proof. The source/support cache may contain support outputs, flake inputs, fixed-output source fetchers, language dependency materializations, toolchains, and derivation closures, but it must exclude the selected final output paths being rebuilt.

```bash
nix copy --to "file://$ARCHIVE_DIR/nix/binary-cache" \
  $(nix-store -qR $(cat "$ARCHIVE_DIR/nix/derivation-paths.txt"))
```

The first implementation may over-include by using the closure of support outputs plus flake inputs; rebuild verification later tightens this into a final-output-excluded cache.

Raw fallback must include flake inputs too:

```bash
nix-store --export \
  $(nix-store -qR \
    $(cat "$ARCHIVE_DIR/nix/store-paths.txt") \
    $(cat "$ARCHIVE_DIR/nix/flake-input-paths.txt") \
    $(cat "$ARCHIVE_DIR/nix/source-support-paths.txt") \
    $(cat "$ARCHIVE_DIR/nix/derivation-paths.txt")) \
  > "$ARCHIVE_DIR/nix/raw-store-closure.nar"
```

When rebuild verification is requested, archive creation must fail if any selected final output has no known derivation path or if a selected language planner reports external fixed-output sources that are absent from `source-support-paths.txt`.

### Phase 7: Source Snapshot

Create reviewed source and generated state separately:

```bash
git archive --format=tar "$SOURCE_COMMIT" | zstd -T0 > source/repo.tar.zst
```

Generated glue belongs in `source/generated-overlay.tar.zst`. Local mode may include `source/git.patch.optional` only when `--include-uncommitted-patch` is explicit.

### Phase 8: Verification

There are three valid verification modes.

#### Substitute Verification

This proves a fresh machine can restore outputs from archive-local caches.

1. Extract `source/repo.tar.zst`.
2. Overlay `source/generated-overlay.tar.zst`.
3. Configure only archive-local caches. If signed, include recorded public keys. If intentionally unsigned and local-only, use an explicit local trust setting and do not fall back to network caches.

   ```bash
   export NIX_CONFIG=$'experimental-features = nix-command flakes\nsubstituters = file:///abs/archive/nix/binary-cache file:///abs/archive/nix/flake-archive\ntrusted-public-keys = <recorded-public-keys-if-signed>\nfallback = false\nconnect-timeout = 1\n'
   ```

   For unsigned local-only caches, the restore script must use an explicit trust mechanism supported by the installed Nix version, such as a trusted local substituter configuration or importing the raw closure before using `--offline`. It must not silently add public network substituters.

4. Do not pass `--offline`; it disables substituters. Block network at the process, container, VM, or CI sandbox layer.
5. Run selected `.#graph-generator-selected` builds and compare output paths. For substitute verification, store paths should match the archived final output paths. For rebuild verification, store paths may differ if the rebuilt derivation is intentionally forced through a final-output-excluded cache; compare declared output metadata, artifact digests, and manifest target mapping instead of requiring identical final store path strings.

#### Import-Then-Offline Verification

This proves the raw archive can populate a local store and then run with Nix offline mode.

1. Import `nix/raw-store-closure.nar`, or copy all binary-cache paths into the local store through a controlled restore step.
2. Run:

   ```bash
   nix build --offline --impure --no-write-lock-file --option eval-cache false \
     --accept-flake-config --no-link --print-out-paths \
     "path:$PWD#graph-generator-selected"
   ```

#### Rebuild Verification

This proves selected final outputs can be re-executed locally from archived inputs. Substitute verification is not enough because a cache containing final outputs can make `nix build` succeed without compiling.

Rebuild verification needs one of:

- A source/support cache containing toolchains, fixed-output sources, flake inputs, PNPM stores, wheelhouses, and module caches, while excluding selected final output paths.
- A fresh store and `nix build --rebuild` with archive-only source/support availability and network blocked.

The first implementation may ship substitute verification. The final feature bar for "build offline" is rebuild verification.

## Restore Workflow

The implementation module is:

```text
build-tools/tools/dev/restore-build-archive.ts
build-tools/tools/bin/restore-build-archive
```

Supported:

```text
restore-build-archive --archive ./viberoots-build-input-archive-<digest>.tar.zst --dest /tmp/vbr-restore --verify=substitute
restore-build-archive --archive ./archive-dir --dest /tmp/vbr-restore --target //projects/apps/sample-webapp:sample-webapp
restore-build-archive --archive ./archive-dir --dest /tmp/vbr-restore --import-store --verify=import-offline
restore-build-archive --archive ./archive-dir --dest /tmp/vbr-restore --verify=rebuild
```

When `--target` is supplied during restore, it must be a subset of `manifest.selection.configuredTargets`; restore must reject targets outside the archived selection instead of attempting to resolve or fetch new inputs.

Restore steps:

1. Verify `manifest.sha256`.
2. Verify all recorded payload digests.
3. Extract source and generated overlays.
4. Configure archive-local `file://` substituters for substitute verification, including the flake-input cache when separate, or import `raw-store-closure.nar` for import-offline verification.
5. Run selected restore build commands.
6. Emit `restore-report.json`.

The restore script must not mutate the user's main checkout.

## Language Requirements

### Node / PNPM

- Map selected graph nodes to importer directories from `lockfile:` labels.
- Build and archive `.#pnpm-store.<sanitized-importer>` for each selected importer.
- Build and archive `.#node-modules.<sanitized-importer>` when selected target kinds need runtime node modules.
- Record lockfile digests, store output paths, and node-modules output paths.
- Verification must set no `NIX_PNPM_ALLOW_GENERATE` and reject attempted lockfile generation.
- Missing `node-modules.hashes.json` entries are fatal for protected archives.

### Go / gomod2nix

- Discover the nearest `gomod2nix.toml` for every selected Go target using the same logic as `graph-generator.nix`.
- Record each modules file path and digest.
- Build selected Go outputs and copy closures, including module sources realized by gomod2nix.
- Protected archives fail if selected Go targets require regenerating `gomod2nix.toml`.
- Verification must not allow network fallback for Go module source resolution.

### Python / uv2nix

- Discover selected Python importers and their `uv.lock` files.
- Build selected Python outputs and matching `py-wheelhouse-*` outputs.
- Record `uv.lock` digest, patch digests, wheelhouse output paths, and selected Python output paths.
- Treat the current local uv2nix shim/stub behavior as insufficient for protected offline rebuild claims unless verification proves the wheelhouse closure contains all required package payloads. If not, implement a true uv materialization layer that records wheel/sdist URLs and hashes or stores realized package payloads in Nix closures.
- Verification must prove no package metadata or wheel fetch occurs.

### C++ / nixpkgs attrs

- Extract selected `nixCxxAttrs` / provider attrs from graph nodes and provider index.
- Build selected C++ outputs and copy closures, including nixpkgs package outputs and source fetcher outputs needed for rebuild.
- Record attr names, provider stamp digests, local patch digests, and whether `NIX_CPP_USE_OVERLAY=1` was used.
- Protected archives reject dev overrides and record overlay mode.

### Rust

Rust templates are placeholder-level today. Before claiming Rust support:

- Implement real Cargo/Nix build templates.
- Require `Cargo.lock` for artifact-producing Rust targets.
- Add crate materialization, likely `cargo vendor` or a Nix-native crate lock translator.
- Add provider sync and patch semantics for Rust crates.
- Archive crate source closures and verify offline.

Until then, `archive-build-inputs` must mark Rust targets as unsupported unless they are known placeholder/probe targets.

## Fresh-Machine Verification

CI verification should use:

- Empty or disposable Nix store when practical.
- Archive cache as the only substituter for substitute verification, or pre-imported store closure for import-offline verification.
- `fallback = false`.
- Network blocked at process/container/VM layer.
- No inherited `GOMODCACHE`, PNPM store, uv cache, npm cache, or Buck daemon state.
- No inherited `NIX_PATH` except one explicitly pointed at archived nixpkgs if required.
- No dev override envs.

On macOS, true empty-store verification is harder because Nix is daemon-managed. The design should still run a best-effort check with archive-only substituters and isolated user caches, while CI should prefer Linux container verification for strict network isolation.

## Deployment Provenance Integration

When a build archive is created for a protected deployment:

- Extend `ControlPlaneArtifactObject["provenance"]["payloadKind"]` and artifact-store tests to accept `build-input-archive`, then upload the archive as a content-addressed object using the existing artifact-store pattern.
- Persist metadata in the existing artifact object metadata table or a new `build_input_archives` table.
- Include `buildInputsFingerprint` in deployment admission evidence.
- Bind `sourceRevision`, selected target set, artifact identity, and build input archive identity.
- Reject deployment admission if the artifact claims a build-input archive that is missing, mutable, expired, or not bound to the same source revision.

## Security and Integrity

- Prefer signed Nix binary caches for shared/protected archives.
- Record public signing keys in the manifest.
- Store private signing keys outside the repo and outside the archive.
- Reject symlinks, path traversal, hardlinks, device files, and absolute paths in source/generated archive payloads.
- Store archive payloads under content-derived names.
- Record every command's env allowlist in verification logs.
- Redact credentials from logs and manifests.
- Never include secret runtime material, `.env` files, netrc files, SSH keys, Nix access tokens, or cloud credentials.

## Implementation Plan

### PR 1: Manifest and Selection Library

- Add `build-tools/tools/dev/build-archive/manifest.ts`.
- Add `build-tools/tools/dev/build-archive/selection.ts`.
- Reuse `project-closure-selector.ts`.
- Add tests for target patterns, project roots, invalid project IDs, and manifest canonical hashing.

### PR 2: Archive CLI Skeleton

- Add `archive-build-inputs.ts` and bin wrapper.
- Implement preflight, source digest capture, glue execution, and generated-file copy.
- Emit manifest without Nix cache export.

### PR 3: Selected Build Materialization

- Build selected targets via filtered `path:` flake refs and `graph-generator-selected` / `packages.<system>.graph-generator-selected`, always with `--no-link --print-out-paths`.
- Collect output store paths and per-target metadata.
- Add failure handling for unsupported Rust and missing target kinds.

### PR 4: Nix Cache Export

- Implement `nix copy --to file://...`.
- Implement `nix flake archive --to file://...`.
- Emit `store-paths.txt`, `flake-input-paths.txt`, `derivation-paths.txt`, `source-support-paths.txt`, `closure-info.json`, and narinfo digests.
- Add raw `nix-store --export` fallback only behind an explicit option.

### PR 5: Language Metadata

- Add Node importer detection and PNPM store output capture.
- Add Go modules file capture.
- Add Python uv/wheelhouse capture.
- Add C++ attr/provider capture.
- Mark Rust unsupported for real archive semantics.

### PR 6: Restore, Substitute Verification, and Import-Offline Verification

- Add `restore-build-archive.ts` and the thin `build-tools/tools/bin/restore-build-archive` wrapper.
- Add `--verify=substitute` and `--verify=import-offline`.
- Implement archive-only Nix config, raw closure import, network-blocked verification, and selected-target restore builds.

### PR 7: Rebuild Verification

- Distinguish final-output cache roots from source/support cache roots.
- Add derivation paths and source-fetcher closure roots where needed.
- Use `--rebuild` or a final-output-excluded cache to prove local rebuild.
- Document platform-specific limits, especially Darwin.

### PR 8: Control-Plane Integration

- Add `build-input-archive` to the control-plane artifact-store payload-kind union and tests.
- Persist archive metadata and immutable conflict checks.
- Bind deployment evidence `buildInputsFingerprint` to archive identity.
- Add replay/retry tests proving exact archive reuse.

## Open Questions

- Should protected archival require generated glue to be committed, or should generated glue remain an explicit overlay artifact? This design recommends overlay artifact first.
- Which target kinds count as artifact-producing for archive defaults? The first implementation should rely on planner language/kind mapping and make unsupported kinds explicit.
- Do we need multi-system archives in one manifest, or one archive per system plus an index manifest? One archive per system is simpler.
- How strict should local dirty-source mode be? Recommended: allow only explicit `--include-uncommitted-patch`, never implicit dirty archives.
- Is substitute verification acceptable for first production use, or does the business requirement demand rebuild verification before launch? The wording "enabling it to build offline" points to rebuild verification as the final bar.

## Acceptance Criteria

- `archive-build-inputs --target <buck-pattern> --verify=substitute` creates an archive and verifies it from a fresh workspace with archive-only Nix substitution and network blocked.
- `archive-build-inputs --selector project-closure --project <project> --verify=substitute` archives all selected project dependency closure targets.
- The manifest records source revision, source tree digest, target selection, graph/glue digests, flake lock digest, flake archive metadata digest, language lockfile digests, store paths, flake input paths, derivation/source-support paths, closure metadata, cache trust, and verification result.
- The generated overlay includes the Composite Graph inputs needed by restore, including `graph.json`, `node-lock-index.json`, and `provider_index.json`.
- `restore-build-archive --verify=import-offline` can import the raw closure and build with `nix build --offline`.
- A restored archive can rebuild selected outputs with network disabled using `--verify=rebuild`.
- CI has at least one strict Linux archive verification job.
- Protected deployment admission can bind a final artifact to `buildInputsFingerprint`.
- Unsupported languages or target kinds fail closed with actionable diagnostics.
