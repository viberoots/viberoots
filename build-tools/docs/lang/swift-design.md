## Swift (with optional Objective‑C) — First‑Class Language Design

Audience: Engineers and LLM agents implementing Swift as a first‑class language in this repository.

### Goals

- Establish Swift (and optional Objective‑C sources within Swift packages) as a first‑class language consistent with existing Go/Node patterns.
- Preserve repository invariants: Buck2 orchestrates, Nix does hermetic builds with dynamic derivations, glue is zx/TypeScript, provider wiring yields precise invalidation, and patches live in flat language‑scoped directories.
- Provide an ergonomic patch workflow via the existing `patch-pkg` CLI, idempotent sync, and auto‑map wiring.

### Fit with Methodology

- Architectural minimalism: small planner registry entry and tiny language templates; push logic into shared helpers.
- Deterministic reliability: Swift toolchains pinned in Nix; avoid network during builds; provider wiring ensures minimal rebuilds.
- Code quality standards: keep scripts small, reuse existing helpers (providers, fs, glue), follow file invariants.

### Scope (Phase 1)

- Swift Package Manager (SPM) projects on macOS and Linux.
- Build Swift projects/apps/libs by invoking SPM within a hermetic Nix derivation.
- Optional Objective‑C (.m/.mm) sources allowed inside SPM targets (via bridging headers) with no additional repository‑level language.
- Patching third‑party SPM packages via a flat `patches/swift/*.patch` and a dev‑override JSON.

Out of scope for Phase 1:

- iOS/watchOS/tvOS app packaging or code signing.
- Xcode project integration. Pure SPM first.

### Linking expectations

I follow the repo-wide linking model described in `build-tools/docs/cpp-linking.md`, `build-tools/docs/wasm-linking.md`, and `build-tools/docs/linking-roadmap.md`. If this language does not introduce native or cross-language linking, `deps` remains a graph edge list and no link intent is inferred.

- `deps` is the Buck graph edge list. It does not imply link intent.
- `link_deps` declares linkable inputs. `header_deps` is include-only when that concept applies.
- Macros compute `deps := deps ∪ link_deps ∪ header_deps` deterministically and validate `link_closure_overrides` keys.
- `link_closure` defaults to `"direct"`. `"transitive"` follows `link_deps` only via `build-tools/tools/nix/planner/link-closure.nix`.
- Ordering is deterministic and unsupported deps fail fast with targeted errors.

### C interop requirement

If the language can support C interop, I must provide a documented and tested path to link or call C code using the repo linking model (explicit `link_deps` and deterministic closure). If the language cannot support C interop, this doc must state why and list the constraints.

### Shared wiring and contracts (current repo)

Use the canonical helper surface from `//build-tools/lang:defs_common.bzl` and `//build-tools/lang:language_wiring.bzl`. Macro call sites should not re‑implement wiring or load provider maps directly.

- Preferred macro entrypoint: `prepare_language_wiring(...)` (non‑mutating), with `wiring=` for `genrule`, `nix_calling_genrule`, `non_genrule`, or `srcsless_rule`.
- Provider wiring: load `MODULE_PROVIDERS` from `//build-tools/lang:auto_map.bzl` and use `providers_for`/`realize_provider_edges` for deterministic provider edges.
- Lockfile labels (importer‑scoped languages): `lockfile:<path>#<importer>` with supported importer roots `.` and `projects/apps/*`/`projects/libs/*`; importer‑scoped macros must live in the importer package so importer‑local patch globs are valid action inputs.
- Patch model contract: `build-tools/lang/lang_contracts.bzl` and `build-tools/tools/lib/lang-contracts.ts` define `patch_scope:*` stamping and whether glue runs on patch apply/remove.
- Global Nix inputs: for Nix‑calling macros, use `wire_global_nix_inputs(...)` so `global_nix_inputs()` are real action inputs; labels are observability only.

### Build route policy

Policy for this language:

- Implement artifact-producing macros as Nix-backed builds.
- Keep Buck as graph and test-impact orchestrator, not the producer of production artifacts.
- Allow orchestration wrappers that call `nix build` when inputs remain hermetic and deterministic.
- Allow probe-only non-build macros only when explicitly documented as non-artifact paths.
- Do not introduce fallback Buck artifact build paths for convenience.

### Enforcement integration requirement

Language rollout is not complete if it only adds build plumbing. I also need to keep migration
policy enforcement current:

- Add and maintain public macro rows in `docs/handbook/nix-gaps.md`.
- Keep intentional non-build macros in `docs/handbook/nix-gaps-exceptions.json` with
  `kind = "probe-only"` and non-empty justification.
- Extend `build-tools/tools/dev/nix-gaps-inventory-check.ts` and related tests under
  `build-tools/tools/tests/dev/` when route contracts change.
- Ensure required repo validation runs this checker so doc/policy drift fails before merge.

---

## Path Invariants and Naming

- Patches live at `patches/swift/*.patch`, one patch per `identity@version` (flat dir, no subdirectories).
- Language templates live under `build-tools/tools/nix/templates/swift.nix` and are imported by `build-tools/tools/nix/lang-templates.nix`.
- Language macros live under `swift/defs.bzl` and use `//build-tools/lang:auto_map.bzl`.
- Provider rules for Swift live under `//third_party/providers/**` and are generated (e.g., `TARGETS.swift.auto`).
- Dev overrides environment variable: `NIX_SWIFT_DEV_OVERRIDE_JSON` with shape `{ "identity@version": "/abs/local/override" }`.

---

## High‑Level Architecture (mirrors Go/Node)

1. Buck2 remains orchestrator, exporter emits labels for Swift targets.
2. Nix `graph-generator.nix` routes Swift targets to `build-tools/tools/nix/templates/swift.nix` functions (`swiftApp`, `swiftLib`).
3. Provider sync scans `patches/swift/*.patch` and writes `third_party/providers/TARGETS.swift.auto`.
4. Auto‑map translates Swift labels → provider deps and macros append them to target deps.
5. `patch-pkg` adds a Swift handler to start/reset/apply/session for SPM packages.

---

## Planner Integration

### Dispatch (graph‑generator.nix)

- Add Swift to the planner dispatch. Detection rules:
  - Prefer stamped labels by macros: `lang:swift`, `kind:bin|lib|test`.
  - Fallback: custom `swift_*` rule types (if present) or mapping via `build-tools/tools/nix/mapping.nix`.

Template selection:

- `swiftApp` for bins, `swiftLib` for libs (tests handled at Buck level, see Macros).

Inputs forwarded to templates:

- `name` (Buck canonical name)
- `packageDir` (repo subdirectory containing `Package.swift`)
- `resolved` (path to `Package.resolved` near `Package.swift`)
- `patchDir` (default `../../patches/swift` from template file location)
- `devOverrideEnv` (default `NIX_SWIFT_DEV_OVERRIDE_JSON`)

---

## Nix Language Templates (build-tools/tools/nix/templates/swift.nix)

Design principles:

- Use Nix to provide a hermetic Swift toolchain and run SPM in an offline/controlled mode.
- Apply patches per dependency identity by creating/editing an SPM workspace and `swift package edit` to point at a temp editable checkout to which we apply patches, or by overlaying sources in the `.build/checkouts` layout prior to build.
- Honor `NIX_SWIFT_DEV_OVERRIDE_JSON`: if set locally, override a dependency source path; in CI, throw.

Sketch:

```nix
{ pkgs }:
let
  lib = pkgs.lib;

  patchesMapFromDir = patchDir: let
    names = if builtins.pathExists patchDir then builtins.attrNames (builtins.readDir patchDir) else [];
    isPatch = name: lib.hasSuffix ".patch" name;
    toKey = name: let
      base = lib.removeSuffix ".patch" name;
      at = lib.findLastIndex (x: x == "@") (lib.stringToCharacters base);
      key = if at == -1 then base else base; # identity@version (lowercased)
    in lib.toLower key;
    step = acc: name:
      let k = toKey name; v = (acc.${k} or []) ++ ["${patchDir}/${name}"]; in acc // { "${k}" = v; };
  in builtins.foldl' step {} (lib.filter isPatch names);

  devOverridesOf = envName: let v = builtins.getEnv envName; in if v == "" then {} else builtins.fromJSON v;

  buildWithSPM = { name, packageDir, resolved, patchDir ? ../../patches/swift, devOverrideEnv ? "NIX_SWIFT_DEV_OVERRIDE_JSON" }:
    let
      patchesMap = patchesMapFromDir patchDir;
      devOverrides = devOverridesOf devOverrideEnv;
      _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then
            builtins.throw "Dev overrides are forbidden in CI" else null;
    in pkgs.stdenv.mkDerivation {
      pname = "swift-${name}";
      version = "0.1.0";
      src = ./.; # repo root; packageDir is used at build time
      nativeBuildInputs = [ pkgs.swift pkgs.git pkgs.patch ];
      dontConfigure = true;
      buildPhase = ''
        set -euo pipefail
        export SWIFTPM_ENABLE_PLUGINS=1
        pkg="${packageDir}"
        cp -a "$pkg" source
        cd source

        # Ensure lockfile present
        if [ -f "${resolved}" ]; then cp "${resolved}" ./Package.resolved; fi

        # Apply dev overrides (editable checkouts)
        if [ -n "${builtins.getEnv devOverrideEnv}" ]; then
          node -e '
            const fs=require("fs");
            const m=JSON.parse(process.env.${devOverrideEnv}||"{}")
            const entries=Object.entries(m)
            const { spawnSync } = require("child_process")
            for (const [key, path] of entries) {
              const id = key.split("@")[0]
              const r = spawnSync("swift", ["package", "edit", id, "--path", path], { stdio:"inherit" })
              if (r.status) process.exit(r.status)
            }
          '
        fi

        # Prepare patches from patchesMap: identity@version => [files]
        node -e '
          const fs=require("fs");
          const child=require("child_process");
          const pm=${lib.generators.toJSON {} patchesMap};
          for (const key of Object.keys(pm)) {
            const id=key.split("@")[0]
            // Create editable checkout to make patch application deterministic
            child.spawnSync("swift", ["package", "edit", id], { stdio:"inherit" });
            for (const f of pm[key]) {
              // Try apply in Packages/<id>
              try {
                process.chdir(`Packages/${id}`)
              } catch {}
              const r=child.spawnSync("git", ["apply", f], { stdio:"inherit" })
              if (r.status) process.exit(r.status)
              process.chdir("../../")
            }
          }
        '

        swift build --configuration release --disable-sandbox --skip-update
      '';
      installPhase = ''
        mkdir -p $out
        cp -a .build $out/build
        # Optionally copy products; callers may reference via Nix output path
      '';
    };
in {
  swiftApp = { name, packageDir, resolved, devOverrideEnv ? "NIX_SWIFT_DEV_OVERRIDE_JSON", patchDir ? ../../patches/swift }:
    buildWithSPM { inherit name packageDir resolved patchDir devOverrideEnv; };
  swiftLib = { name, packageDir, resolved, devOverrideEnv ? "NIX_SWIFT_DEV_OVERRIDE_JSON", patchDir ? ../../patches/swift }:
    buildWithSPM { inherit name packageDir resolved patchDir devOverrideEnv; };
}
```

Notes:

- We rely on SPM’s `package edit` to materialize an editable checkout for dependencies we want to patch or override. This avoids rewriting SPM internals and keeps builds reproducible.
- `--skip-update` ensures we do not fetch newer revisions than those in `Package.resolved`.
- Phase 1 copies the build directory into `$out` (consumers can pick products by path). Later phases can make product selection explicit (bins, libs).

---

## WASM Targets (Experimental)

With repository WASM/WASI facilities available, Swift can target WASM via the emerging Swift WASI toolchain:

- Planner/templates: add `swiftWasiApp` to `build-tools/tools/nix/templates/swift.nix` that drives `swift build` for a WASI target when supported; reuse patch/override maps.
- Buck macros: introduce a `nix_swift_wasm_binary` (or `wasm = "wasi"`) that stamps `kind:wasm` and forwards configuration to the planner.
- Tests: execute minimal exports under `node:wasi` and assert behavior.

Status: toolchain maturity varies; treat as a later phase without blocking baseline Swift.

---

## Exporter Labels (build-tools/tools/buck/export-graph.ts)

Two‑phase labeling strategy:

- Phase A (lockfile‑scoped): Attach a deterministic lockfile label to Swift targets so provider wiring can be importer‑scoped immediately:
  - Format: `lockfile:<relative/path/to/Package.resolved>#<packageDir>`
  - Example: `lockfile:features/auth/Package.resolved#features/auth`

- Phase B (per‑module): Add a Swift adapter that shells out to `swift package show-dependencies --format json` (per config tuple if needed) and attaches per‑module labels:
  - Format: `spm:<identity>@<versionOrRevision>` (lowercased)
  - Example: `spm:alamofire@5.7.1` or `spm:swift-collections@<rev>` if version absent

`gen-auto-map.ts` will map either style to providers:

- Lockfile labels → importer‑scoped provider (already supported by Node flow).
- `spm:` labels → per‑module providers (use existing `providerNameForModuleKey(imp, ver)` with `imp=identity`).

---

## Provider Sync and Auto‑Map

### Provider Rules

Add `//third_party/providers/defs_swift.bzl`:

```starlark
def swift_package_patch(name, package_key, patch_path):
    genrule(
        name = name,
        srcs = [patch_path],
        out = name + ".stamp",
        cmd = """
            if command -v sha256sum >/dev/null; then
              cat $SRCS | sha256sum > $OUT
            else
              cat $SRCS | shasum -a 256 > $OUT
            fi
        """,
        visibility = ["//visibility:public"],
    )
```

### Generator (zx): build-tools/tools/buck/sync-providers-swift.ts

Behavior mirrors Go and Node generators:

- Scan `patches/swift/*.patch`; decode `identity@version`; enforce one patch per key; warn on subdirs.
- Name providers deterministically using `build-tools/tools/lib/providers.ts` (reuse `providerNameForModuleKey`, or introduce a small `providerNameForSpmKey` alias that calls the same helper to keep naming uniform).
- Emit `third_party/providers/TARGETS.swift.auto` with sorted rules.

```ts
#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import crypto from "node:crypto";
import { providerNameForModuleKey } from "../lib/providers";

const PATCH_DIR = "patches/swift";
const OUT = "third_party/providers/TARGETS.swift.auto";

function decodeKey(file: string): string | null {
  if (!file.endsWith(".patch")) return null;
  const base = file.slice(0, -".patch".length);
  return base.toLowerCase(); // identity@version
}

const entries: string[] = [];
const byKey = new Map<string, string>();
const seenName = new Map<string, string>();
if (await fs.pathExists(PATCH_DIR)) {
  for (const e of await fs.readdir(PATCH_DIR, { withFileTypes: true })) {
    if (e.isDirectory()) {
      console.warn(`[patches/swift] ignoring subdirectory ${e.name}`);
      continue;
    }
    const key = decodeKey(e.name);
    if (!key) continue;
    const prev = byKey.get(key);
    if (prev && prev !== e.name)
      throw new Error(`Duplicate patch for ${key}: ${prev} vs ${e.name}`);
    byKey.set(key, e.name);
    const [id, ver = ""] = key.split("@");
    const name = providerNameForModuleKey(id, ver);
    const pn = seenName.get(name);
    if (pn && pn !== key) throw new Error(`Provider collision: ${name} => ${pn} vs ${key}`);
    seenName.set(name, key);
    entries.push(
      `swift_package_patch(name = "${name}", package_key = "${key}", patch_path = "${PATCH_DIR}/${e.name}")`,
    );
  }
}

entries.sort();
const header = `# GENERATED — DO NOT EDIT\nload("//third_party/providers:defs_swift.bzl", "swift_package_patch")\n\n`;
await fs.outputFile(OUT, header + entries.join("\n") + "\n");
console.log("wrote", OUT);
```

### Auto‑map (build-tools/tools/buck/gen-auto-map.ts)

Extend existing mapping logic to understand `spm:` labels (treated like `module:`), or, for Phase A, rely purely on existing lockfile mapping since the label is `lockfile:...#importer`.

Minimal addition for `spm:` labels:

```ts
if (l.startsWith("spm:")) {
  const key = l.slice("spm:".length).toLowerCase();
  list.push(nameForModuleProvider(key));
}
```

---

## Buck Macros (swift/defs.bzl)

Provide thin wrappers that stamp labels and append auto‑mapped providers, mirroring Go macros:

```starlark
load("@prelude//cxx:cxx.bzl", "cxx_library")  # placeholder; real rules may differ

def _providers_for(name):
    MODULE_PROVIDERS = {}
    load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    return MODULE_PROVIDERS.get(key, [])

def swift_library(name, **kwargs):
    labels = kwargs.pop("labels", []) + ["lang:swift", "kind:lib"]
    deps = kwargs.pop("deps", []) + _providers_for(name)
    # For Phase 1, model as cxx_library (mixed with ObjC if needed) or a genrule wrapper
    cxx_library(name = name, labels = labels, deps = deps, **kwargs)

def swift_binary(name, **kwargs):
    labels = kwargs.pop("labels", []) + ["lang:swift", "kind:bin"]
    deps = kwargs.pop("deps", []) + _providers_for(name)
    cxx_library(name = name, labels = labels, deps = deps, **kwargs)

def swift_test(name, **kwargs):
    labels = kwargs.pop("labels", []) + ["lang:swift", "kind:test"]
    deps = kwargs.pop("deps", []) + _providers_for(name)
    cxx_library(name = name, labels = labels, deps = deps, **kwargs)
```

Notes:

- The exact underlying Buck rules for Swift may differ (e.g., dedicated `swift_*` rules or Apple rules). For Phase 1, treat these macros as stamping/wiring entry points. The build is performed in Nix via SPM; Buck graphs the providers and consumes Nix outputs via genrules if/when needed.

---

## Patch Workflow (patch-pkg)

Add a Swift handler (`build-tools/tools/patch/patch-swift.ts`) implementing the shared `LanguageHandler` interface:

- `start <identity>`: Locate the Swift package in the Nix store (from the resolved lock), or fetch the exact revision, then create a writable temp dir. If `$PATCH_EDITOR` is set, open it.
- `session <identity>`: Like start; Ctrl‑D applies; Ctrl‑C resets.
- `apply <identity>`: Produce unified diff against the clean source for that `identity@version` and write `patches/swift/<identity>@<version>.patch`; then run `sync-providers-swift.ts` and `gen-auto-map.ts`.
- `reset <identity>`: Remove override entry and temp dir.

Idempotency:

- Re‑apply of the same patch is a no‑op.
- Dev overrides warn locally and are forbidden in CI.

---

## CI Integration (Jenkins)

Stages mirror existing design:

1. Export Graph → writes `build-tools/tools/buck/graph.json` (Swift adapter included but may start in lockfile mode only).
2. Sync Providers (Go + Swift + Node) → updates `TARGETS*.auto`.
3. Generate auto_map → writes `third_party/providers/auto_map.bzl`.
4. Pre‑build guard → ensures glue freshness.
5. Build & Test → Buck builds that depend on Swift providers; Nix builds SPM packages.

Pre‑build guard additions:

- If any `patches/swift/*.patch` exist, require `TARGETS.swift.auto` to be present.

---

## Testing Strategy

- Provider determinism tests (zx): one‑test‑per‑file verifying idempotent sync and collision detection for Swift patches.
- Auto‑map wiring tests (zx): ensure Swift targets labeled with lockfile or `spm:` labels receive the correct providers and exclude irrelevant ones.
- E2E provider‑wiring (zx): replicate existing `build-tools/tools/tests/e2e-provider-wiring.ts` pattern with Swift examples.

Timeout conventions and coverage flags match repository standards.

---

## Phased Implementation Plan

### Phase A — Minimal Enablement

- Add `build-tools/tools/buck/sync-providers-swift.ts`, `third_party/providers/defs_swift.bzl`.
- Extend `gen-auto-map.ts` if needed for `spm:` later; for now ensure lockfile labels work.
- Wire planner dispatch and `build-tools/tools/nix/templates/swift.nix` with SPM build using `Package.resolved` only.
- Add macros `swift/defs.bzl` (stamp labels, append providers).
- Add `patch-pkg` Swift handler with `start/apply/reset/session` minimal flow.

Acceptance:

- With a dummy patch `patches/swift/alamofire@5.7.1.patch`, provider sync emits deterministic `TARGETS.swift.auto`; auto‑map includes Swift providers for targets labeled with the relevant lockfile.

### Phase B — Per‑module Exporter Labels

- Implement Swift exporter adapter that runs `swift package show-dependencies --format json` per packageDir.
- Attach `spm:<identity>@<versionOrRevision>` labels to targets, with accurate transitive closure.
- Update auto‑map to include `spm:` providers (simple mapping to module provider names).

Acceptance:

- Patching an unrelated SPM package does not rebuild targets that do not transitively depend on it.

### Phase C — Dev Overrides

- Enable `NIX_SWIFT_DEV_OVERRIDE_JSON` in templates (warn local, throw in CI).
- Add `build-tools/tools/dev/clear-overrides.ts` parity for Swift variable.

Acceptance:

- Local overrides change derivation and speed iteration; CI fails when overrides are set.

### Phase D — Tests and Guardrails

- Add zx tests for provider determinism, auto‑map wiring, and exporter accuracy.
- Pre‑build guard enforces presence of Swift providers when patches exist.

### Phase E — ObjC Sources (optional)

- Document that `.m/.mm` in SPM targets are supported transparently; no separate provider system. Validate by adding a small mixed target fixture in tests.

### Phase F — Hardening

- Improve Nix template to copy specific products (bins/libs) to `$out` with stable paths.
- Optimize dependency checkout/patch application.

---

## Key Assumptions (to validate)

- `pkgs.swift` exists and is usable on all supported platforms; we can run `swift build` in a hermetic derivation.
- `swift package edit <identity>` reliably creates an editable checkout directory where patches can be applied with `git apply`.
- `Package.resolved` provides deterministic inputs for dependency versions or revisions; `--skip-update` prevents network drift.
- Mixed Swift/ObjC within SPM targets requires no special Buck integration; SPM handles the bridging.
- For per‑module labels (Phase B), `swift package show-dependencies --format json` is stable and sufficient to map target → transitive package identities.

---

## Risks and Mitigations

- Cross‑platform toolchains (risk: medium): macOS and Linux Swift toolchains differ.
  - Mitigation: pin Swift toolchains in Nix; gate Linux builds initially if needed; add CI matrix later.

- Patching third‑party deps via SPM edit (risk: medium): fragile if SPM layout changes.
  - Mitigation: standardize on `package edit` rather than patching `.build/checkouts` directly; maintain a small adapter layer; integration tests.

- Network access during build (risk: medium): SPM may attempt to fetch.
  - Mitigation: vendor inputs via lockfile; pre‑fetch with Nix (future enhancement) or rely on `--skip-update` and Nix sandbox with allowed URLs hashed via fixed‑output fetchers in later phases.

- Exporter correctness for `spm:` labels (risk: low/medium): dependency graph nuances (local packages, revisions).
  - Mitigation: tests covering replace‑like scenarios (local path deps), branch/pseudo revisions; fall back to lockfile labels until stable.

- Macro backing rule choice (risk: low): using `cxx_library` placeholders may not reflect Swift semantics.
  - Mitigation: keep macros thin; the actual build happens in Nix; evolve macros later if native Swift rules are available.

- ObjC interop edge cases (risk: low): bridging headers and module maps.
  - Mitigation: rely on SPM conventions; add a small mixed fixture test.

---

## Areas of Concern

- Determinism of SPM resolution under Nix sandbox without prefetching all deps as fixed outputs; Phase A accepts limited risk controlled by `--skip-update`.
- Mapping SPM identities to canonical lowercase `identity@version` keys when versions are absent (revision‑only dependencies); choose `identity@<rev>` and document.
- Product discovery in `$out` for Buck consumption; we will standardize output subpaths in Phase F.

---

## Completion Criteria (Phase 1)

- `patches/swift/` exists; `sync-providers-swift.ts` generates deterministic `TARGETS.swift.auto` from patches.
- Planner dispatch routes Swift targets to `swiftApp/swiftLib` templates in `build-tools/tools/nix/templates/swift.nix`.
- Swift targets carry lockfile labels and auto‑map includes Swift providers for those targets.
- `patch-pkg` supports Swift with start/apply/reset/session and updates glue automatically.
- Pre‑build guard enforces presence of Swift provider files when Swift patches exist.

---

## Appendix: Example TARGETS Entries (Swift)

```starlark
load("//swift:defs.bzl", "swift_library", "swift_binary", "swift_test")

swift_library(
  name = "auth_lib",
  srcs = glob(["Sources/Auth/**/*.swift"]),
  labels = [
    "lang:swift",
    "kind:lib",
    # Phase A lockfile label:
    "lockfile:features/auth/Package.resolved#features/auth",
  ],
)

swift_binary(
  name = "auth_service",
  srcs = ["Sources/AuthMain/main.swift"],
  deps = [":auth_lib"],
  labels = [
    "lang:swift",
    "kind:bin",
    "lockfile:features/auth/Package.resolved#features/auth",
  ],
)
```
