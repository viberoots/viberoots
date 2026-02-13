# Kotlin/JVM Integration — First‑Class Language Design

> Audience: Engineers and LLM agents implementing Kotlin/Java (JVM) in this repository.
> Scope: Kotlin as a first‑class language with optional Java and other JVM sources where trivial.

---

## Goals

- Integrate Kotlin (and Java where applicable) following the repo’s methodology and patterns.
- Preserve Buck2 as orchestrator, Nix as builder with dynamic derivations, and provider‑based invalidation.
- Reuse existing glue (export‑graph, provider sync, auto_map) with minimal JVM‑specific code.
- Support reproducible dependency resolution and deterministic patching of third‑party Maven artifacts.

## Design Principles (aligned with Methodology)

- Architectural minimalism: small, composable pieces; reuse helpers from existing languages.
- Deterministic operations: fixed lockfiles, hermetic fetches, CI fails on dev overrides.
- Code quality: small files, clear naming, avoid comments except where non‑obvious.
- Feature control: ship the smallest viable path; defer complex features to later phases.

## Linking expectations

I follow the repo-wide linking model described in `build-tools/docs/cpp-linking.md`, `build-tools/docs/wasm-linking.md`, and `build-tools/docs/linking-roadmap.md`. If this language does not introduce native or cross-language linking, `deps` remains a graph edge list and no link intent is inferred.

- `deps` is the Buck graph edge list. It does not imply link intent.
- `link_deps` declares linkable inputs. `header_deps` is include-only when that concept applies.
- Macros compute `deps := deps ∪ link_deps ∪ header_deps` deterministically and validate `link_closure_overrides` keys.
- `link_closure` defaults to `"direct"`. `"transitive"` follows `link_deps` only via `build-tools/tools/nix/planner/link-closure.nix`.
- Ordering is deterministic and unsupported deps fail fast with targeted errors.

## C interop requirement

If the language can support C interop, I must provide a documented and tested path to link or call C code using the repo linking model (explicit `link_deps` and deterministic closure). If the language cannot support C interop, this doc must state why and list the constraints.

## Shared wiring and contracts (current repo)

Use the canonical helper surface from `//build-tools/lang:defs_common.bzl` and `//build-tools/lang:language_wiring.bzl`. Macro call sites should not re‑implement wiring or load provider maps directly.

- Preferred macro entrypoint: `prepare_language_wiring(...)` (non‑mutating), with `wiring=` for `genrule`, `nix_calling_genrule`, `non_genrule`, or `srcsless_rule`.
- Provider wiring: load `MODULE_PROVIDERS` from `//build-tools/lang:auto_map.bzl` and use `providers_for`/`realize_provider_edges` for deterministic provider edges.
- Lockfile labels (importer‑scoped languages): `lockfile:<path>#<importer>` with supported importer roots `.` and `projects/apps/*`/`projects/libs/*`; importer‑scoped macros must live in the importer package so importer‑local patch globs are valid action inputs.
- Patch model contract: `build-tools/lang/lang_contracts.bzl` and `build-tools/tools/lib/lang-contracts.ts` define `patch_scope:*` stamping and whether glue runs on patch apply/remove.
- Global Nix inputs: for Nix‑calling macros, use `wire_global_nix_inputs(...)` so `global_nix_inputs()` are real action inputs; labels are observability only.

## Build route policy

Policy for this language:

- Implement artifact-producing macros as Nix-backed builds.
- Keep Buck as graph and test-impact orchestrator, not the producer of production artifacts.
- Allow orchestration wrappers that call `nix build` when inputs remain hermetic and deterministic.
- Allow probe-only non-build macros only when explicitly documented as non-artifact paths.
- Do not introduce fallback Buck artifact build paths for convenience.

## Enforcement integration requirement

Language rollout is not complete if it only adds build plumbing. I also need to keep migration
policy enforcement current:

- Add and maintain public macro rows in `docs/handbook/nix-gaps.md`.
- Keep intentional non-build macros in `docs/handbook/nix-gaps-exceptions.json` with
  `kind = "probe-only"` and non-empty justification.
- Extend `build-tools/tools/dev/nix-gaps-inventory-check.ts` and related tests under
  `build-tools/tools/tests/dev/` when route contracts change.
- Ensure required repo validation runs this checker so doc/policy drift fails before merge.

---

## End‑to‑End Architecture

The flow mirrors Go and Node patterns:

1. Buck2 targets for Kotlin/Java are labeled and wrapped by thin macros in `//jvm/defs.bzl`.
2. `build-tools/tools/buck/export-graph.ts` exports a configured graph with labels.
3. `graph-generator.nix` routes JVM nodes to `build-tools/tools/nix/templates/jvm.nix`.
4. Nix derivations build JARs with a dependency classpath from a lockfile.
5. Patching is key‑ed by Maven coordinates and applied via providers derived from `patches/jvm/*.patch`.
6. `gen-auto-map.ts` maps target labels to provider deps, limiting invalidation to impacted targets.

---

## Path Invariants

- Patches: `patches/jvm/*.patch` (flat; one patch per key). No subdirectories.
- Templates: `build-tools/tools/nix/templates/jvm.nix` (consumed by `build-tools/tools/nix/lang-templates.nix`).
- Planner: dispatch entry in `graph-generator.nix` (language registry) for JVM.
- Macros: `jvm/defs.bzl` using `build-tools/lang/defs_common.bzl` helpers.
- Providers:
  - Starlark: `//third_party/providers/defs_jvm.bzl` with `jvm_artifact_patch(...)`.
  - Generated: `third_party/providers/TARGETS.jvm.auto` (deterministic; not hand‑edited).
- Glue scripts (zx/TypeScript):
  - `build-tools/tools/buck/sync-providers-jvm.ts` (scan patches/jvm → write TARGETS.jvm.auto)
  - `build-tools/tools/buck/gen-auto-map.ts` (already supports lockfile labels; extended as needed)
  - `build-tools/tools/dev/install-deps.ts` integration to (re)generate `build-tools/tools/nix/jvm-deps.nix` from a lockfile

---

## Labels and Invalidation Model

We reuse the lockfile‑scoped invalidation pattern (like Node) to keep mapping simple and precise initially.

- Primary label format on targets:
  - `lockfile:<relative/path/to/jvm.lock>#<importer>`

  Examples:
  - `lockfile:projects/apps/service-a/jvm.lock#projects/apps/service-a`
  - `lockfile:projects/libs/common/jvm.lock#projects/libs/common`

- Optional per‑artifact labeling (Phase 2+):
  - `mvn:<group>/<artifact>@<version>` for refined per‑artifact provider mapping (mirrors Go’s `module:<path>@<version>`). This is introduced after exporter work stabilizes.

`gen-auto-map.ts` already maps `lockfile:` labels to importer‑scoped providers via `providerNameForImporter`. No change required to get JVM online with the per‑lockfile model.

---

## Patching Keys and Filenames

- Key format for patches (artifact coordinates):
  - `mvn:<group>/<artifact>@<version>`
  - Lowercased for stable comparisons (case preserved in filenames only where required).

- Patch filename encoding (flat dir):
  - Replace `/` with `__` inside the key portion prior to `@`.
  - Canonical filename: `<encoded>@<version>.patch`
  - Example: `mvn:org.jetbrains.kotlin__kotlin-stdlib@1.9.24.patch`

Providers reference these patches deterministically; only one patch per `mvn:<g>/<a>@<v>` is allowed.

---

## Glue Generators

### Provider Sync (JVM)

Add a zx script that mirrors Go’s provider sync:

```ts
#!/usr/bin/env zx-wrapper
// build-tools/tools/buck/sync-providers-jvm.ts
import fs from "fs-extra";
import crypto from "node:crypto";
import { providerNameForImporter, shortHash } from "../lib/providers";

const PATCH_DIR = "patches/jvm";
const OUT_FILE = "third_party/providers/TARGETS.jvm.auto";

function decodeKey(n: string): string | null {
  if (!n.endsWith(".patch")) return null;
  const base = n.slice(0, -".patch".length);
  const at = base.lastIndexOf("@");
  if (at < 0) return null;
  const enc = base.slice(0, at);
  const ver = base.slice(at + 1);
  const dec = enc.replace(/__/g, "/");
  // Ensure prefix present (mvn:)
  const key = dec.startsWith("mvn:") ? dec : `mvn:${dec}`;
  return `${key.toLowerCase()}@${ver.toLowerCase()}`;
}

function providerNameForArtifact(moduleKey: string): string {
  const h = shortHash(moduleKey, 12);
  // mvn:group/art@ver → tail like group_art__ver
  const [prefixAndCoord, ver] = moduleKey.split("@");
  const coord = prefixAndCoord.replace(/^mvn:/, "");
  const tail =
    `${coord.split("/").slice(-2).join("_")}__${ver.replace(/[.@]/g, "_")}`.toLowerCase();
  return `mvn_${h}_${tail}`;
}

async function main() {
  const entries: string[] = [];
  const byKey = new Map<string, string>();
  const seen = new Map<string, string>(); // providerName -> key

  if (await fs.pathExists(PATCH_DIR)) {
    for (const f of await fs.readdir(PATCH_DIR)) {
      const key = decodeKey(f);
      if (!key) continue;
      const prior = byKey.get(key);
      if (prior && prior !== f) throw new Error(`Duplicate patch for ${key}: ${prior} vs ${f}`);
      byKey.set(key, f);
      const name = providerNameForArtifact(key);
      const prev = seen.get(name);
      if (prev && prev !== key)
        throw new Error(`Provider name collision: ${name} for ${prev} vs ${key}`);
      seen.set(name, key);
      entries.push(
        `jvm_artifact_patch(name = "${name}", artifact_key = "${key}", patch_path = "${PATCH_DIR}/${f}")`,
      );
    }
  }

  entries.sort();
  const header = [
    "# GENERATED FILE — DO NOT EDIT.",
    'load("//third_party/providers:defs_jvm.bzl", "jvm_artifact_patch")',
    "",
  ].join("\n");

  await fs.outputFile(OUT_FILE, header + "\n" + entries.join("\n") + "\n");
  console.log("wrote", OUT_FILE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

### Auto‑map

No changes required for the lockfile model. If we later emit `mvn:` per‑artifact labels, extend `gen-auto-map.ts` with:

```ts
// Map labels starting with "mvn:" to providerNameForArtifact()
```

This mirrors the existing `module:` mapping for Go.

---

## Starlark Providers

Add a tiny provider in `//third_party/providers/defs_jvm.bzl`:

```starlark
def jvm_artifact_patch(name, artifact_key, patch_path):
    genrule(
        name = name,
        srcs = [patch_path],
        out = name + ".stamp",
        cmd = "if command -v sha256sum >/dev/null; then cat $SRCS | sha256sum > $OUT; else cat $SRCS | shasum -a 256 > $OUT; fi",
        visibility = ["//visibility:public"],
    )
```

This mirrors the Go provider and ensures content‑addressed invalidation on patch changes.

---

## Buck Macros (`//jvm/defs.bzl`)

Thin wrappers over underlying language rules, appending provider deps from `auto_map.bzl` and stamping labels (`lang:jvm`, `kind:*`). These remain minimal; build conventions can evolve centrally.

```starlark
load("@prelude//java:def.bzl", "java_library", "java_test", "java_binary")

def _providers_for(name):
    MODULE_PROVIDERS = {}
    load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    return MODULE_PROVIDERS.get(key, [])

def nix_jvm_library(name, labels = [], deps = [], **kwargs):
    labels = labels + ["lang:jvm", "kind:lib"]
    deps = deps + _providers_for(name)
    java_library(name = name, labels = labels, deps = deps, **kwargs)

def nix_jvm_binary(name, labels = [], deps = [], **kwargs):
    labels = labels + ["lang:jvm", "kind:bin"]
    deps = deps + _providers_for(name)
    java_binary(name = name, labels = labels, deps = deps, **kwargs)

def nix_jvm_test(name, labels = [], deps = [], **kwargs):
    labels = labels + ["lang:jvm", "kind:test"]
    deps = deps + _providers_for(name)
    java_test(name = name, labels = labels, deps = deps, **kwargs)
```

Label stamping for lockfiles is done by the caller using the macro’s `labels` arg (Phase 0), then automated later via exporter adapter (Phase 2) to reduce manual wiring.

---

## Nix Language Templates (`build-tools/tools/nix/templates/jvm.nix`)

The template exposes two functions analogous to Go’s `goApp`/`goLib`:

```nix
{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };

  # importers: mapping from importer id to a derivation providing a classpath
  # jvmDepsNix should be generated by a zx script from a lockfile (coursier/maven)
in {
  jvmApp = { name, lockfile, importer, devOverrideEnv ? "NIX_JVM_DEV_OVERRIDE_JSON", patchDir ? ../../patches/jvm }:
    let
      patchesMap   = H.patchesMapFromDir patchDir;
      devOverrides = H.readDevOverrides devOverrideEnv;
      _ = H.guardNoDevOverridesInCI devOverrideEnv;
      deps = import ../../build-tools/tools/nix/jvm-deps.nix { inherit pkgs lib; lockfilePath = lockfile; importerId = importer; };
    in pkgs.stdenv.mkDerivation {
      pname = "jvm-${name}";
      version = "0.1.0";
      src = ./.;
      buildInputs = [ pkgs.jdk pkgs.kotlin ];
      # Simplified: compile sources in subdir with classpath from deps.classpath
      # Apply patches to any overridden artifacts by rebuilding them from sources (future phase)
      buildPhase = ''
        mkdir -p $out/classes
        CLASSPATH=${deps.classpath}
        # Example: compile all sources; in practice, pass proper source roots
        find . -name '*.kt' -o -name '*.java' > sources.list || true
        if [ -s sources.list ]; then
          ${pkgs.kotlin}/bin/kotlinc -cp "$CLASSPATH" -d $out/lib.jar @sources.list || true
          ${pkgs.jdk}/bin/javac -cp "$CLASSPATH" -d $out/classes @sources.list || true
          ${pkgs.jdk}/bin/jar cf $out/${name}.jar -C $out/classes . || true
        else
          mkdir -p $out && echo "empty module" > $out/EMPTY
        fi
      '';
      installPhase = ''
        mkdir -p $out
      '';
    };

  jvmLib = { name, lockfile, importer, devOverrideEnv ? "NIX_JVM_DEV_OVERRIDE_JSON", patchDir ? ../../patches/jvm }:
    let
      patchesMap   = H.patchesMapFromDir patchDir;
      devOverrides = H.readDevOverrides devOverrideEnv;
      _ = H.guardNoDevOverridesInCI devOverrideEnv;
      deps = import ../../build-tools/tools/nix/jvm-deps.nix { inherit pkgs lib; lockfilePath = lockfile; importerId = importer; };
    in pkgs.stdenv.mkDerivation {
      pname = "jvmlib-${name}";
      version = "0.1.0";
      src = ./.;
      buildInputs = [ pkgs.jdk pkgs.kotlin ];
      buildPhase = ''
        mkdir -p $out/classes
        CLASSPATH=${deps.classpath}
        find . -name '*.kt' -o -name '*.java' > sources.list || true
        if [ -s sources.list ]; then
          ${pkgs.kotlin}/bin/kotlinc -cp "$CLASSPATH" -d $out/lib.jar @sources.list || true
          ${pkgs.jdk}/bin/javac -cp "$CLASSPATH" -d $out/classes @sources.list || true
          ${pkgs.jdk}/bin/jar cf $out/${name}.jar -C $out/classes . || true
        else
          mkdir -p $out && echo "empty lib" > $out/EMPTY
        fi
      '';
      installPhase = ''
        mkdir -p $out
      '';
    };
}
```

Notes:

- The above is intentionally simple; real builds will refine source roots, output shapes, and Jar assembly logic.
- `build-tools/tools/nix/jvm-deps.nix` is a generated file that yields a single `classpath` string for the importer, constructed from fixed‑output fetches of Maven artifacts via Coursier metadata.
- Dev overrides (`NIX_JVM_DEV_OVERRIDE_JSON`) will later enable replacing an artifact with a local path for iteration before patching.

---

## WASM Targets (Exploratory)

With repository‑level WASM/WASI facilities in place, we plan an optional path for JVM→WASM:

- Tooling candidates: TeaVM, CheerpJ, or similar. Scope is limited to projects compatible with these toolchains.
- Buck/Planner: add an optional `nix_jvm_wasm_binary` (or `wasm = true`) macro and a `jvmWasmApp` template that drives the selected tool to produce `.wasm` artifacts.
- Providers/patching: reuse existing lockfile/patch/override maps; no special provider semantics required.
- Tests: load freestanding artifacts with `WebAssembly.instantiate` or use `node:wasi` if WASI‑compatible.

This is a later‑phase enhancement and does not block the baseline JVM integration.

---

## Dependency Resolution and Lockfiles

Hermetic classpaths come from a per‑importer lockfile (`jvm.lock`) checked into each `projects/apps/*` or `projects/libs/*` project.

- Lockfile generator (zx): `build-tools/tools/dev/jvm/generate-lock.ts`
  - Inputs: `build.gradle(.kts)` or `pom.xml`, or an explicit `deps.txt` of Maven coordinates.
  - Implementation: shell out to `cs resolve`/`cs fetch --json` (Coursier) to get the transitive dependency set with URLs and checksums; generate a Nix file `build-tools/tools/nix/jvm-deps.nix` that resolves artifacts as fixed‑output derivations and constructs the classpath at eval time.
  - Integration: invoked from `build-tools/tools/dev/install-deps.ts` when JVM projects are detected.

Lockfile label wiring:

- Macros accept and stamp: `labels = ["lockfile:<relpath>#<importer>"]` in Phase 0.
- Exporter adapter (Phase 2) will infer and add this label automatically based on macro attrs or conventions, reducing manual wiring.

---

## `patch-pkg` Integration (JVM)

Add a new handler `build-tools/tools/patch/patch-jvm.ts` implementing the shared `LanguageHandler` interface with subcommands `start/reset/apply/session`:

- `start <mvn:group/artifact@ver>`
  - Locate and fetch the corresponding source jar via Coursier (from Nix‑provided metadata), copy to a temp writable dir (APFS CoW on macOS; `cp -a` elsewhere).
  - Record temp path in `.patch-sessions.json`.
  - Launch `$PATCH_EDITOR` if set.

- `apply <mvn:...>`
  - Create unified diff `patches/jvm/<encoded>.patch` using the canonical encoding.
  - Run glue: `node build-tools/tools/buck/sync-providers-jvm.ts` then `node build-tools/tools/buck/gen-auto-map.ts`.
  - Clear the dev override and delete the temp dir.

- `reset <mvn:...>`
  - Remove dev override and delete temp dir without writing a patch.

- `session <mvn:...>`
  - Long‑lived session: Ctrl‑D applies, Ctrl‑C resets.

Dev override env var: `NIX_JVM_DEV_OVERRIDE_JSON` maps artifact keys to local source directories for rapid iteration (warn locally; hard‑fail in CI).

---

## Exporter Adapter (Phase 2)

Extend `build-tools/tools/buck/export-graph.ts` (or language‑specific adapter module) to:

- Detect JVM targets (via `lang:jvm` label stamped by macros or via `rule_type` predicate) and attach `lockfile:<path>#<importer>` labels deterministically.
- Optional: when artifact metadata is available, attach `mvn:<group>/<artifact>@<version>` labels to targets that resolve those artifacts (enables per‑artifact provider mapping later).
- Keep CI strictness: validations are errors in CI, warn‑only locally when requested.

---

## Planner Dispatch (`graph-generator.nix`)

Add a JVM entry in the dispatch registry akin to Go/Node:

- `isTarget(n)`: rule*type starts with `java*`or label`lang:jvm` present.
- `kindOf(n)`: `bin|lib|test` from labels or rule type.
- `modulesFileFor(name)`: path to `jvm.lock` (relative to repo root).
- `mkApp(name)`, `mkLib(name)`: call into `build-tools/tools/nix/templates/jvm.nix` using the lockfile path and importer id.

The planner remains tiny: it passes only essentials (name, kind, lockfile path, importer id) to the template.

---

## CI Stages and Guardrails

Add/extend Jenkins stages:

1. Export Graph (unchanged)
2. Sync Providers (JVM) → writes `TARGETS.jvm.auto`
3. Generate auto_map → updates `third_party/providers/auto_map.bzl`
4. Pre‑build guard: fail if glue files missing or stale
5. Build & Test (Buck)

`build-tools/tools/buck/prebuild-guard.ts` should treat `patches/jvm/*.patch` presence as requiring at least one `TARGETS.jvm.auto` file.

---

## Implementation Plan (Phased)

### Phase 0 — Scaffolding & Glue

- Create dirs/files: `patches/jvm/` (empty), `third_party/providers/defs_jvm.bzl`, `build-tools/tools/buck/sync-providers-jvm.ts`.
- Add minimal `//jvm/defs.bzl` stamping `lang:jvm` and appending providers.
- Wire sync into `build-tools/tools/buck/sync-providers.ts` orchestrator if present.
- Acceptance:
  - Sync runs idempotently with empty patch set (produces deterministic `TARGETS.jvm.auto`).
  - Macros compile (no behavior change yet).

### Phase 1 — Lockfile & Classpath

- Add `build-tools/tools/dev/jvm/generate-lock.ts` to produce `jvm.lock` and `build-tools/tools/nix/jvm-deps.nix` via Coursier.
- Integrate with `build-tools/tools/dev/install-deps.ts` so `jvm-deps.nix` regenerates when inputs change.
- Acceptance:
  - For a sample JVM project, `jvm-deps.nix` provides a stable classpath derivation.

### Phase 2 — Exporter Labels

- Extend exporter to stamp `lockfile:<path>#<importer>` on JVM targets (or require macro attr until exporter lands).
- Add warn‑only validation locally for inconsistent labeling; error in CI.
- Acceptance:
  - Buck graph shows expected labels; `gen-auto-map.ts` generates providers for JVM targets.

### Phase 3 — Nix Templates

- Implement `build-tools/tools/nix/templates/jvm.nix` with `jvmApp`/`jvmLib` as above (simple compile path).
- Planner dispatch routes `lang:jvm` nodes to these templates.
- Acceptance:
  - A small Kotlin/Java lib and bin build successfully with the computed classpath.

### Phase 4 — Patching Flow

- Implement `build-tools/tools/patch/patch-jvm.ts` with start/apply/reset/session.
- Apply a dummy patch to a dependency that the sample project uses; verify provider sync and invalidation path.
- Acceptance:
  - Only targets that depend on the importer’s lockfile rebuild when a relevant patch changes.

### Phase 5 — Hardening & Per‑artifact Providers (Optional)

- Add optional `mvn:` per‑artifact labels; extend auto*map to map them to `mvn*\*` providers.
- Teach templates to rebuild patched artifacts from source jars and substitute them in classpath.
- Add targeted zx tests mirroring Go/Node tests for provider determinism and wiring.

---

## Testing Strategy

- Add zx tests under `build-tools/tools/tests/…`:
  - Provider sync determinism: idempotent output from identical `patches/jvm`.
  - Auto‑map wiring: targets with `lockfile:` labels have the expected provider deps.
  - e2e wiring (template from `build-tools/docs/build-system-design.md`): modifying unrelated patch does not affect rule key; related patch does.
  - Exporter validation tests: missing/incorrect labels fail in CI mode.

---

## Assumptions to Validate

- Coursier (`cs`) and Kotlin compiler (`kotlinc`) are available in Nixpkgs across `aarch64-darwin`, `aarch64-linux`, `x86_64-linux`.
- We can generate a reproducible `jvm.lock` and Nix `jvm-deps.nix` with stable checksums for all required Maven artifacts (including source jars).
- `@prelude` (or repo‑local forwarding) exposes `java_*` rules; Kotlin sources can be compiled via `kotlinc` in Nix templates initially (macro wraps Java rules but actual artifact build is via Nix template like Go).
- Annotation processors (kapt) and multi‑module Gradle setups are out of scope for Phase 0–3; we start with plain Kotlin/Java sources without APs.

---

## Risks and Mitigations

- Dependency graph complexity (Maven):
  - Risk: divergent resolution w.r.t. Gradle/Maven plugins.
  - Mitigation: use Coursier resolution consistently; document constraints; gate large features behind later phases.

- Source jar availability:
  - Risk: not all artifacts publish sources; patching from sources may be impossible.
  - Mitigation: allow dev overrides to local forks; document fallback (vendor minimal fork for patching if necessary) as last resort; prefer per‑lockfile providers initially.

- Kotlin/Java mixed compilation order:
  - Risk: naive compile script may not handle cycles or APs.
  - Mitigation: limit Phase 3 to simple source layouts; add targeted support for APs and Kotlin‑first compiles later.

- Performance and cache size:
  - Risk: large classpaths increase build time; rebuilding patched artifacts may be expensive.
  - Mitigation: importer‑scoped invalidation limits rebuild scope; use fixed‑output fetches and shared caches; add per‑artifact provider later for finer granularity.

- CI parity across platforms:
  - Risk: toolchain differences across macOS/Linux.
  - Mitigation: stick to Nixpkgs toolchains; validate on all three architectures.

---

## Areas of Concern

- Annotation processing (kapt), `ksp`, and bytecode‑weaving plugins are intentionally deferred; these require bespoke handling in both Nix templates and exporter labeling.
- Gradle plugin ecosystems: we avoid invoking Gradle inside Nix to preserve hermeticity and simplicity; this may limit certain builds until a future phase.
- Precise per‑artifact invalidation depends on exporter capabilities; plan allows shipping with lockfile‑scoped invalidation first.

---

## Completion Criteria (Phase 3 baseline)

- `patches/jvm/` recognized; `TARGETS.jvm.auto` generated deterministically.
- `jvm/defs.bzl` macros usable; targets stamped with `lang:jvm` and `lockfile:` labels.
- `build-tools/tools/nix/jvm-deps.nix` produced from `jvm.lock`; simple Kotlin/Java lib/bin builds via Nix templates on all target platforms.
- `gen-auto-map.ts` includes JVM providers for labeled targets; impacted targets rebuild when relevant patches change.

---

## Appendix: Example TARGETS Entries

```starlark
load("//jvm:defs.bzl", "nix_jvm_library", "nix_jvm_binary", "nix_jvm_test")

nix_jvm_library(
    name = "core",
    srcs = glob(["src/main/**/*.kt", "src/main/**/*.java"]),
    labels = ["lockfile:projects/apps/service-a/jvm.lock#projects/apps/service-a"],
)

nix_jvm_binary(
    name = "service",
    srcs = ["src/main/kotlin/Main.kt"],
    deps = [":core"],
    labels = ["lockfile:projects/apps/service-a/jvm.lock#projects/apps/service-a"],
)

nix_jvm_test(
    name = "core_test",
    srcs = glob(["src/test/**/*.kt", "src/test/**/*.java"]),
    deps = [":core"],
    labels = ["lockfile:projects/apps/service-a/jvm.lock#projects/apps/service-a", "kind:test"],
)
```

This mirrors existing patterns (Go/Node): macro stamping, importer‑scoped lockfile label, providers injected from `auto_map.bzl`.
