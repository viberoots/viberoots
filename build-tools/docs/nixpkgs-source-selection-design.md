# Nixpkgs Source Selection Design

This document designs target-scoped nixpkgs source selection for Nix-backed Buck targets.
The implementation should land in a small, usable shape first, then extend to package-level pins
without replacing the underlying model.

The code must not use milestone names such as `V1`, `V2`, `phase1`, or `phase2` in public APIs,
internal identifiers, comments, tests, generated graph fields, or diagnostics. Those labels are only
planning shorthand. User-facing and code-facing names should describe the behavior directly:
`nixpkgs_profile`, `nixpkg_pins`, `sourcePlanFor`, `pkgsForProfile`, and similar names.

## Current State

The repo currently has one nixpkgs input and one imported `pkgs` set per supported system.
`flake.nix` declares `inputs.nixpkgs`, `per-system-context.nix` imports it once, and
`graph-generator.nix` receives that single `pkgs` value.

Targets can already declare nixpkgs package attributes through `nixpkg_deps`. The macros normalize
those entries into `nixpkg:<attr>` labels, the Buck graph exports those labels, and the Nix planner
resolves the attrs against the single `pkgs` value. For example, `nixpkg_deps = ["pkgs.openssl"]`
means "resolve `pkgs.openssl` from the active workspace nixpkgs input."

This means:

- A target cannot choose a different nixpkgs commit today.
- A target cannot safely use `pkgs.openssl` from one commit and `pkgs.zlib` from another today.
- The graph contract loses source identity because `nixpkg:pkgs.openssl` carries an attr only, not a
  nixpkgs profile or pin.
- Current C++, Go CGO, and Python native extension flows dedupe nixpkgs dependencies by attr string,
  which would collapse same-name attrs from different nixpkgs sources.

## Goals

- Let an individual Nix-backed target select a named nixpkgs profile.
- Keep BUILD files readable and reviewable.
- Keep raw commits out of target definitions.
- Make package source identity first-class internally from the start, so package-level pins extend
  the model instead of replacing it.
- Keep target selection deterministic under Buck, Nix, local builds, CI, filtered flake snapshots,
  and remote build preparation.
- Fail closed for ambiguous or invalid source selection.
- Give diagnostics that explain which nixpkgs profile and package pins affected a selected build.

## Non-Goals

- Do not support arbitrary per-target flake refs or raw commits in BUILD files.
- Do not fetch nixpkgs commits dynamically during planning.
- Do not make labels the source of truth for nixpkgs source selection.
- Do not silently change source selection; profile choices and pin choices must be explicit graph
  inputs.
- Do not solve general dependency override policy for every language in one step.

## User Model

Users should think in two layers:

1. A target may select a base nixpkgs profile.
2. A target may later pin specific nixpkgs package attrs to named nixpkgs profiles when a narrower
   exception is needed.

The common case is a whole target profile:

```starlark
nix_cpp_test(
    name = "compat_test",
    srcs = ["compat_test.cc"],
    nixpkg_deps = ["pkgs.openssl"],
    nixpkgs_profile = "nixpkgs-23_11",
)
```

The narrower exception case is a target that normally uses the default profile but gets one package
attr from another named nixpkgs profile:

```starlark
nix_cpp_binary(
    name = "tls_compat_client",
    srcs = ["main.cc"],
    nixpkg_deps = [
        "pkgs.openssl",
        "pkgs.zlib",
    ],
    nixpkgs_profile = "default",
    nixpkg_pins = {
        "pkgs.openssl": {
            "nixpkgs_profile": "nixpkgs-23_11",
            "rationale": "Compatibility with an older TLS peer during migration.",
        },
    },
)
```

Package-level pins are intentionally more explicit than profile selection. They should be used for
reviewed compatibility cases, not as the default way to choose dependencies.

### Source Selection Decision

The UX should optimize for a coherent package universe first:

- Use `nixpkgs_profile` when the target needs an older or alternate native dependency stack.
- Use `nixpkg_pins` when a small number of packages can be safely sourced from another profile
  without changing the rest of the target's native package universe.
- A pin means every use of that normalized attr by the selected target resolves from the pin's
  `nixpkgs_profile`. The pin is not scoped to "build", "headers", "link", or "runtime".
- Each pin carries its own `rationale` because each pinned attr is the reviewed exception.

This is intentionally broad. The same semantics apply to compilers, formatters, interpreters, native
libraries, package managers, code generators, and runtime bundles. Viberoots does not decide whether
a package combination is semantically compatible. If a user pins only one side of a coupled tool and
runtime pair, the underlying build may fail, and the user can then pin the needed attrs or move the
whole target to a coherent `nixpkgs_profile`.

Examples:

```starlark
# Coherent older native stack. This is the preferred shape when the target links
# old OpenSSL and old curl from the same nixpkgs snapshot.
nix_cpp_binary(
    name = "tls_compat_client",
    srcs = ["tls_compat_client.cc"],
    nixpkg_deps = [
        "pkgs.openssl",
        "pkgs.curl",
    ],
    nixpkgs_profile = "nixpkgs-23_11",
)
```

```starlark
# Narrow exception. Every use of pkgs.clang-tools by this target resolves from
# nixpkgs-23_11. Viberoots does not need to know whether the attr is a tool,
# library, or runtime package.
nix_cpp_binary(
    name = "generated_table",
    srcs = ["main.cc"],
    nixpkg_deps = [
        "pkgs.clang-tools",
        "pkgs.zlib",
    ],
    nixpkg_pins = {
        "pkgs.clang-tools": {
            "nixpkgs_profile": "nixpkgs-23_11",
            "rationale": "Temporary generator behavior needed by checked-in fixtures.",
        },
    },
)
```

```starlark
# Another narrow exception. The syntax is the same regardless of how the package
# is used by the language template.
nix_cpp_test(
    name = "json_compat_test",
    srcs = ["json_compat_test.cc"],
    nixpkg_deps = [
        "pkgs.nlohmann_json",
    ],
    nixpkg_pins = {
        "pkgs.nlohmann_json": {
            "nixpkgs_profile": "nixpkgs-23_11",
            "rationale": "Test fixture expects JSON formatting from this package version.",
        },
    },
)
```

```starlark
# Linked/runtime use has the same pin syntax. If the chosen combination is
# incompatible, the build should fail in the normal package/build layer.
nix_cpp_binary(
    name = "isolated_tls_probe",
    srcs = ["probe.cc"],
    nixpkg_deps = [
        "pkgs.openssl",
        "pkgs.zlib",
    ],
    nixpkg_pins = {
        "pkgs.openssl": {
            "nixpkgs_profile": "nixpkgs-23_11",
            "rationale": "Compatibility with an older TLS peer while the server is migrated.",
        },
    },
)
```

If the exception grows until most of the target wants the older package universe, promote the pin to
the target-level profile:

```starlark
nix_cpp_binary(
    name = "tls_compat_client",
    srcs = ["main.cc"],
    nixpkg_deps = [
        "pkgs.openssl",
        "pkgs.curl",
        "pkgs.zlib",
    ],
    nixpkgs_profile = "nixpkgs-23_11",
)
```

### API Principles

The BUILD API should stay declarative:

- `nixpkg_deps` names packages.
- `nixpkgs_profile` names the default package source for this target.
- `nixpkg_pins` maps normalized package attrs to per-attr profile overrides.
- Each `nixpkg_pins` entry has a `nixpkgs_profile` and a non-empty `rationale`.

The BUILD API should not expose:

- raw commits
- flake URLs
- nar hashes
- Nix import arguments
- overlays as inline expressions
- arbitrary functions or lambdas

This keeps review focused on intent. The registry and lockfile carry the exact source identity.

### Attribute Defaults

All Nix-backed macros should behave as if these defaults were present:

```starlark
nixpkgs_profile = "default"
nixpkg_pins = {}
```

Macros should not require users to set `nixpkgs_profile = "default"` explicitly. Diagnostics may
print the default profile when useful.

### Raw Commit Escape Hatch

There should be no target-local raw commit escape hatch. If a new nixpkgs commit is needed quickly,
the fast path is:

1. Add a named flake input or registry source.
2. Add a named profile.
3. Use that profile name from BUILD files, either as the target's `nixpkgs_profile` or inside a
   `nixpkg_pins` entry.

This is still fast, but it keeps source changes visible in `flake.lock` and the registry diff.

## Registry Model

All nixpkgs sources must be declared centrally and be lockfile-backed. The registry should expose
stable names, not commits.

Conceptual shape:

```nix
{
  profiles = {
    default = inputs.nixpkgs;
    nixpkgs-23_11 = inputs.nixpkgs_23_11;
  };
}
```

The initial implementation keeps the default registry at
`build-tools/tools/nix/nixpkgs-source-registry.nix`. Consumer overrides should use documented
viberoots extension points, not ad hoc files under `projects/`.

Registry requirements:

- Every profile has a stable identifier.
- Every profile resolves through flake inputs and `flake.lock`.
- Unknown profile names fail during analysis or planner evaluation.
- Profile identifiers are safe for graph JSON, labels, logs, and attr names.
- Profiles may include a rationale string, but it is optional because standard named profiles can be
  self-explanatory.
- The registry supports all repository systems: `aarch64-darwin`, `aarch64-linux`, and
  `x86_64-linux`.

### Registry Ownership

The viberoots source tree should own the reusable schema and default profile. Consumer repositories
may need their own additional profiles. That should happen through a reviewed extension point in the
workspace flake generation path, not by copying viberoots registry files into `projects/`.

The registry should be loadable in three contexts:

- The viberoots source repo.
- A consumer workspace using `.viberoots/workspace/flake.nix`.
- A filtered flake snapshot used by selected-target builds.

If a registry file cannot be found or parsed, selected builds should fail with a targeted diagnostic
that names the expected registry path and the selected target.

### Profile Import Policy

Each profile should be imported with the same system as the selected build. Profile import policy
should be explicit and consistent:

```nix
pkgsForProfile = profileName:
  import registry.profiles.${profileName}.input {
    inherit system;
    overlays = overlaysForProfile profileName;
    config = configForProfile profileName;
  };
```

The default profile should preserve existing behavior. Existing overlays that are currently global
must be assigned deliberately:

- either they apply only to the default profile
- or they are declared as shared overlays for specific profiles

Do not let an overlay silently apply to all profiles just because it existed before profiles did.

### Registry Schema

The registry should have an explicit schema version so future changes fail clearly:

```nix
{
  schemaVersion = "nixpkgs-source-registry@1";
  profiles = { ... };
}
```

The schema should validate:

- profile names are unique
- optional profile rationale strings are plain strings
- profile import config is data, not executable target-local code

Package pin resolution checks the target-local pin object:

```starlark
nixpkg_pins = {
    "pkgs.openssl": {
        "nixpkgs_profile": "nixpkgs-23_11",
        "rationale": "Compatibility with legacy TLS peer during migration.",
    },
}
```

- The target pin key must normalize to the same canonical form used for `nixpkg_deps`.
- The pin's `nixpkgs_profile` must name a registry profile.
- The pin's `rationale` must be a non-empty string.
- A pin key that normalizes to an attr absent from the selected target's resolved nixpkg attr set
  should fail or warn according to the implemented policy; it must not silently create an undeclared
  package dependency.

The selected target's resolved nixpkg attr set is the set of normalized attrs the planner will
consume while building that selected target. It may include attrs declared directly on the target and
attrs collected through planner-visible dependency paths, depending on the language template. The
important rule is that a pin may redirect an attr the selected plan already consumes; it must not
introduce a new package dependency by itself.

There is intentionally no separate reusable package-pin registry namespace in this design. The BUILD file
maps attrs directly to named nixpkgs profiles, and the rationale lives at the target site where the
exception is reviewed. If many targets need the same exception, they can repeat the local rationale or
move the whole target to the alternate `nixpkgs_profile`; a future design can add reusable aliases if
that repetition becomes a real maintenance problem.

## Graph Contract

The Buck graph should carry source selection as explicit fields:

```json
{
  "name": "//projects/apps/demo:tool",
  "labels": ["lang:cpp", "kind:bin", "nixpkg:pkgs.openssl"],
  "nixpkgs_profile": "default",
  "nixpkg_pins": {
    "pkgs.openssl": {
      "nixpkgs_profile": "nixpkgs-23_11",
      "rationale": "Compatibility with legacy TLS peer during migration."
    }
  }
}
```

Labels may include observability stamps such as `nixpkgs-profile:default`, but the planner must read
the explicit fields as the source of truth. This follows the existing global Nix inputs policy:
labels are useful diagnostics, not invalidation authority.

The graph exporter should:

- Add `nixpkgs_profile` and `nixpkg_pins` to the cquery and inline attr lists.
- Normalize package pin keys using the same nixpkgs attr normalization used by `nixpkg_deps`.
- Update both cquery export in `build-tools/tools/buck/exporter/cquery/attrs.ts` and inline export
  in `build-tools/tools/buck/export-inline.ts`.
- Share TypeScript normalization for `nixpkg_pins` so cquery and inline graph exports preserve the
  same nested map shape.
- Reject malformed pin maps early where Buck analysis can surface a clear error.
- Preserve compatibility for targets that omit all new fields by treating them as
  `nixpkgs_profile = "default"` and `nixpkg_pins = {}`.

### Starlark Macro Contract

The shared macro wiring path should own defaulting and validation. Language macros should not each
re-implement the semantics.

Expected Starlark responsibilities:

- Accept `nixpkgs_profile` and `nixpkg_pins` for Nix-backed artifact macros that consume
  `nixpkg_deps`.
- Normalize `nixpkg_pins` keys using the same helper that normalizes `nixpkg_deps`.
- Preserve `nixpkg_pins` as a dict attr on the underlying rule or planner-visible stub.
- Stamp observability labels only after the explicit attrs are present.
- Reject non-string profile names, non-dict pin maps, non-dict pin entries, missing pin
  `nixpkgs_profile` values, and empty pin `rationale` values during Buck analysis where possible.
- Reject obvious raw commit-looking values and raw flake URLs during Buck analysis where possible.

Registry membership is planner validation, not Buck analysis validation. The registry is Nix and
flake-backed, and consumer workspaces may extend it through generated workspace flake inputs. Starlark
should validate shape and cheap local invariants; the planner should validate that referenced profiles
exist in the registry for the selected system.

Planner-visible stubs must carry the same source-selection attrs as the public target they represent.
If a public macro uses a companion target for selected planning, the companion is the node the planner
sees and must receive the source plan.

Required Starlark surfaces include:

- `build-tools/lang/nixpkg_labels.bzl` for canonical nixpkgs attr normalization.
- `build-tools/lang/macro_kwargs.bzl` for shared `nixpkg_deps`, `nixpkgs_profile`, and `nixpkg_pins`
  extraction.
- `build-tools/lang/language_wiring.bzl` for package-local and importer-local macro propagation.
- `build-tools/lang/planner_visible_wiring.bzl` for companion targets and planner-visible stubs.
- Language macro files such as `build-tools/cpp/defs.bzl` that pass attrs to underlying rules.
- Planner-visible rule definitions such as `build-tools/lang/planner_stub.bzl`.
- Nix-calling rules such as `build-tools/cpp/private/nix_build.bzl`.

Where rule attrs are needed, `nixpkg_pins` should be represented as a nested string dictionary, for
example `attrs.dict(key = attrs.string(), value = attrs.dict(key = attrs.string(), value =
attrs.string()), default = {})`, with Starlark helper validation enforcing the required keys.

### Graph Field Names

Use snake_case for exported graph fields because the graph already uses names such as
`link_deps`, `link_closure`, and `link_closure_overrides`.

Use the same snake_case field names in exported graph fields and source-plan values unless an
existing local helper already requires a different shape. Avoid exposing multiple names for the same
concept across layer boundaries.

## Internal Resolver Model

The first implementation should not pass a target-specific `pkgs` value directly into every template
and call that complete. That would work for whole-target profiles, but it would make package-level
pins a later rewrite.

Instead, the planner should normalize every selected target to a package source plan:

```nix
{
  nixpkgs_profile = "default";
  nixpkg_pins = {
    "pkgs.openssl" = {
      nixpkgs_profile = "nixpkgs-23_11";
      rationale = "Compatibility with legacy TLS peer during migration.";
    };
  };
}
```

Then all nixpkgs attr resolution should go through one resolver:

```nix
resolveNixpkgAttr {
  target = "//projects/apps/demo:tool";
  attr = "pkgs.openssl";
}
```

The resolver returns structured data:

```nix
{
  attr = "pkgs.openssl";
  profile = "nixpkgs-23_11";
  pin = {
    nixpkgs_profile = "nixpkgs-23_11";
    rationale = "Compatibility with legacy TLS peer during migration.";
  };
  package = <derivation>;
}
```

For a target with no package pins, every attr resolves from `nixpkgs_profile`. For a target with
`nixpkg_pins`, matching attrs resolve from the pin's `nixpkgs_profile`. The resolver should be the
only path from a `nixpkg:` label to a package derivation.

### Resolver Invariants

The resolver should be pure with respect to its explicit inputs:

- registry
- selected system
- selected target node
- normalized attr
- lockfile-backed flake inputs

It must not read ambient environment variables to choose a profile or pin. Environment variables are
acceptable only for existing selected-target plumbing such as `BUCK_TARGET` and `BUCK_GRAPH_JSON`,
not for package source identity.

The resolver should normalize attrs before lookup, then use normalized attrs everywhere internally.
If a user writes `openssl`, `pkgs.openssl`, or another accepted alias, the source plan should contain
only the canonical value.

When resolving `nixpkg_pins`, the resolver must validate the target-local pin object. A resolved
package pin is valid only if:

- the target attr key normalizes successfully
- the pin entry has a `nixpkgs_profile`
- the pin's `nixpkgs_profile` exists in the registry
- the pin entry has a non-empty `rationale`

Failure diagnostics should include the selected target, normalized attr, requested profile name, and
the registry path to edit.

### Source Plan Examples

Whole-target profile:

```nix
{
  nixpkgs_profile = "nixpkgs-23_11";
  nixpkg_pins = {};
}
```

Package pin:

```nix
{
  nixpkgs_profile = "default";
  nixpkg_pins = {
    "pkgs.openssl" = {
      nixpkgs_profile = "nixpkgs-23_11";
      rationale = "Compatibility with legacy TLS peer during migration.";
    };
  };
}
```

Resolved package records:

```nix
[
  {
    attr = "pkgs.openssl";
    resolution_kind = "nixpkg_pin";
    profile_name = "nixpkgs-23_11";
    profile = "nixpkgs-23_11";
    rationale = "Compatibility with legacy TLS peer during migration.";
    package = <derivation>;
  }
  {
    attr = "pkgs.zlib";
    resolution_kind = "target_profile";
    profile_name = "default";
    profile = "default";
    package = <derivation>;
  }
]
```

## Planner Integration

The planner context should expose:

- `nixpkgsRegistry`
- `pkgsForProfile profileName`
- `sourcePlanFor node`
- `resolveNixpkgAttr { target; attr; }`
- `resolveNixpkgAttrs { target; attrs; }`

Language planners should keep collecting attrs from existing `nixpkg:` labels, but should stop
resolving attrs directly against `pkgs`. C++, Go CGO, and Python native extension paths should call
the resolver.

Templates that need toolchains from the base profile may still use the target's base profile. For
example, a C++ target's compiler and stdenv should come from the base profile unless a future
reviewed design changes toolchain selection.

### Language Scope

C++ is the first language to wire because it already has the clearest curated `nixpkg_deps` path and
native link semantics. Go CGO and Python native extension paths should share the resolver rather than
copying a C++-specific implementation.

Expected language behavior:

- C++: `nixpkg_deps` resolve through the target source plan. Package compatibility failures are left
  to the normal compile, link, test, and packaging flow.
- Go CGO: transitive `nixpkg:` labels resolve through the consuming target source plan. CGO package
  records should include source identity in diagnostics.
- Python native extensions: C++ dependency integration and native package attrs use the same resolver
  and source-plan policy.
- Node: ordinary PNPM package materialization remains unchanged. C++ Node addons inherit the C++
  policy. Planner-selected Node tooling should stay with the target-level profile unless a separate
  design changes that behavior.

### Template Boundary

Templates should receive either:

- resolved package derivations, plus source metadata for diagnostics
- or a resolver object scoped to the target

They should not receive a raw graph node and re-parse source-selection fields themselves. The planner
owns graph interpretation; templates own building.

The current Nix template stack is closed over one imported `pkgs` set. This design requires a
multi-profile boundary before source selection can be correct. The implementation should choose one
of these shapes:

- Instantiate language templates with the selected target's base-profile `pkgs`, and pass resolved
  pinned package records separately for attrs that come from other profiles.
- Or keep templates profile-neutral and pass both `base_profile_pkgs` and resolved package records into
  template constructors.

Either way, whole-target `nixpkgs_profile` must affect the compiler, stdenv, and ordinary package
resolution for the selected target, while `nixpkg_pins` override only the normalized attrs they name.
The templates must not continue resolving nixpkg attrs against a single global `pkgs` value.

For C++, this means helpers equivalent to `resolveAttrsToPkgs` should return resolved records or
derive the package list from resolved records. The old attr-only helper can remain as a compatibility
wrapper only if it calls the new resolver.

### Toolchain Policy

Base profile selection should affect toolchains and packages for the selected target. That is the
least surprising behavior: a target that asks for `nixpkgs-23_11` gets the compiler, stdenv, and
packages from that profile.

Package-level pins should not change implicit planner-selected toolchains. A target with
`nixpkg_pins` still gets its compiler and stdenv from the target-level `nixpkgs_profile`; only the
pinned normalized attrs come from their declared package profiles. If a compiler-like package is
listed as an explicit `nixpkg_deps` attr, the pin applies to that explicit attr, but it does not
change the template's implicit compiler or stdenv selection.

This policy should be documented in diagnostics because it is the difference between:

- "build this target in an older package universe"
- "build this target normally, except use this one older package"

## Dedupe And Identity

Package identity must include source identity:

```text
(nixpkgs_profile, normalized_attr)
```

Do not dedupe by attr alone once package pins exist. This is especially important for cases where
two closure paths refer to `pkgs.zlib` from different profiles.

The planner should report conflicts in terms of target labels, normalized attrs, and profile names.
Diagnostics should avoid commits unless the user asks for low-level lockfile evidence.

### Provider Mapping

Generated provider mapping currently treats `nixpkg:<attr>` as the key for provider targets. Source
selection should not require a provider target per profile. Provider targets remain graph edges for
declaring that a target uses a nixpkgs attr. Source selection belongs to target metadata and planner
resolution.

If provider generation later needs source identity, it should add a structured field or sidecar
rather than encoding profile names into legacy provider labels by default.

## Mixed Source Policy

Whole-target profile selection is allowed by default. Package-level pins are also allowed when each
pin explicitly names the alternate `nixpkgs_profile` and provides a non-empty `rationale`.

Viberoots should not maintain package-specific compatibility knowledge. It should not know that one
attr is a tool, another is a library, or that a given code generator must match a given runtime
library. Its responsibility is deterministic source selection:

- validate profile names
- normalize attr keys
- resolve the same attr from the same profile everywhere within the selected target
- preserve source identity in planner records and diagnostics
- avoid deduping attrs from different profiles as if they were the same package

If the user chooses an incompatible mixture, the underlying build should fail normally. The fix is for
the user to pin the additional attrs they need or move the target to a coherent `nixpkgs_profile`.

### Conflict Examples

These cases should fail because source selection itself is ambiguous or invalid:

- `nixpkg_pins["pkgs.openssl"].nixpkgs_profile` names a profile that does not exist in the registry.
- A pin entry is missing a non-empty `rationale`.
- A pin key does not normalize to a valid nixpkgs attr.
- A pin key normalizes to an attr absent from the selected target's resolved nixpkg attr set,
  according to the implemented undeclared-pin policy.

These cases should not be rejected by viberoots purely because they might be semantically
incompatible:

- A target pins `pkgs.protobuf` without pinning some other protobuf-related attr.
- A target pins `pkgs.openssl` while `pkgs.zlib` remains on the base profile.
- A target pins a package that happens to contain both executables and libraries.

Those combinations may still fail during compilation, linking, testing, or runtime packaging. That is
acceptable; viberoots should make the source plan obvious enough for the user to diagnose and adjust
the pins.

## Dev Overrides And Overlays

Current C++ dev overrides are keyed by attr string. Package pins require one of these behaviors:

- Prefer: key overrides by profile and attr.
- Acceptable initial behavior: reject dev overrides when a selected target uses package pins.

Overlay behavior should be profile-aware. An overlay intended for the default profile should not
silently apply to packages from another profile unless the registry explicitly attaches it there.

## Invalidation

Profile and pin configuration must be real action/planner input, not just a label stamp.

At minimum, changes to these files must invalidate affected selected builds:

- `flake.lock`
- the central nixpkgs source registry
- Starlark target attrs that set `nixpkgs_profile` or `nixpkg_pins`
- planner resolver code
- language templates that consume resolved packages

The existing global Nix inputs helper should be extended or paired with a new helper so Nix-calling
actions declare the registry input consistently.

### Filtered Flake And Remote Build Inputs

Filtered flake snapshots must include:

- the registry file
- flake input declarations used by registry profiles
- `flake.lock`
- graph JSON with source-selection fields
- planner resolver code

Remote build source snapshots and cache manifests should include enough source-plan evidence to
explain cache keys. At minimum, manifests should record the selected target's `nixpkgs_profile` and
package pin profile names. They do not need to duplicate raw commit hashes when `flake.lock` is
already part of the source evidence, but low-level tooling may include lock node revisions in debug
output.

A minimal manifest shape is:

```json
{
  "target": "//projects/apps/demo:tool",
  "nixpkgs_profile": "default",
  "nixpkg_pins": {
    "pkgs.openssl": {
      "nixpkgs_profile": "nixpkgs-23_11"
    }
  }
}
```

The manifest does not need to include pin rationales unless a consuming tool wants review context;
cache identity needs the selected profile names and normalized attrs.

Implementation surfaces to update:

- Generated workspace flakes in `build-tools/tools/lib/consumer-bootstrap.ts` so consumer workspaces
  can expose additional lockfile-backed nixpkgs inputs and registry extension data.
- Selected build source choice in `build-tools/tools/dev/build-selected.ts` so local selected builds
  use the same registry and graph fields as filtered snapshots.
- Filtered snapshot helpers in `build-tools/tools/dev/filtered-flake.ts` and
  `build-tools/tools/dev/nix-build-filtered-flake.ts` so registry files and generated workspace flake
  inputs survive snapshotting.
- Shared filtered-flake root/exclude policy in `build-tools/tools/dev/nix-build-filtered-flake-lib.ts`
  so selected C++ and other filtered builds include the same registry inputs.
- C++ action filtered builds in `build-tools/cpp/private/nix_build.bzl`, which route selected C++
  builds through `nix-build-filtered-flake.ts`.
- Remote build source snapshot and manifest code documented in `build-tools/docs/remote-build-setup.md`
  so cache evidence includes the source plan.
- Source snapshot generation in `build-tools/tools/dev/source-snapshot.ts`.
- Cache manifest construction and publication in `build-tools/tools/ci/cache-manifest.ts` and
  `build-tools/tools/ci/publish-nix-cache-manifest.ts`.
- Global input wiring in `build-tools/lang/global_inputs.bzl` or a neighboring helper so registry
  files are action inputs where Nix is called from Buck.

Local selected builds, filtered flake builds, and remote-prepared builds must resolve the same source
plan for the same target. That parity should be a required validation gate.

### Cache Behavior

Changing a target's `nixpkgs_profile` or `nixpkg_pins` should change the selected derivation identity.
Changing an unused registry profile should not invalidate unrelated selected targets unless the
registry file is treated as one coarse global input. A coarse input is acceptable initially for
simplicity, but the design should not depend on it forever.

If registry changes become noisy, the planner can derive per-target source-plan fingerprints and
include only the selected plan in derivation names or environment.

## Diagnostics

Selected builds should print concise diagnostics in debug or failure contexts:

```text
[planner] nixpkgs source plan for //projects/apps/demo:tool:
  nixpkgs_profile=default
  nixpkg_pins=pkgs.openssl:nixpkgs-23_11
```

Failure diagnostics should explain the fix:

```text
cpp planner: unknown nixpkgs_profile in package pin for //projects/apps/demo:tool:
  attr: pkgs.openssl
  requested profile: nixpkgs-23_11
  fix: define nixpkgs-23_11 in build-tools/tools/nix/nixpkgs-source-registry.nix,
       or change nixpkg_pins["pkgs.openssl"].nixpkgs_profile.
```

Diagnostics should also make valid multi-profile plans visible:

```text
cpp planner: nixpkgs source plan for //projects/apps/demo:tool:
  pkgs.openssl -> nixpkgs-23_11
  pkgs.zlib -> default
```

Missing rationale diagnostics should point at the exact pin:

```text
cpp planner: nixpkg_pins["pkgs.openssl"] for //projects/apps/demo:tool requires a non-empty rationale
  attr: pkgs.openssl
  profile: nixpkgs-23_11
```

Debug tooling should also expose source plans through graph inspection or a small planner inspection
command. A good output shape is:

```json
{
  "target": "//projects/apps/demo:tool",
  "nixpkgs_profile": "default",
  "packages": [
    {
      "attr": "pkgs.openssl",
      "profile": "nixpkgs-23_11"
    },
    {
      "attr": "pkgs.zlib",
      "profile": "default"
    }
  ],
  "multiple_nixpkgs_profiles": true
}
```

## High-Level Sequencing

Start with the whole-target profile surface while implementing the resolver-shaped internals.

Recommended order:

1. Add the registry and profile resolver.
2. Add `nixpkgs_profile` to macro attrs, graph export, and selected planner diagnostics.
3. Route nixpkgs attr resolution through `resolveNixpkgAttr`, even before package pins are exposed.
4. Validate whole-target profile selection for C++ first, then Go CGO and Python native extension
   paths.
5. Add package pin fields and source-aware dedupe.
6. Add profile-aware dev override and overlay behavior.

This sequence keeps the first user-visible feature small while making the fast-follow package pin
feature an extension of the same resolver contract.

The first usable increment should still use the final names. Do not introduce temporary names such as
`legacy_nixpkgs_profile`, `nixpkgs_profile_v1`, or `multi_nixpkgs_experimental`. If an API is not
ready for users, keep it undocumented or guarded by validation, but keep internal names descriptive.

### Rollout Compatibility

The whole-target profile surface can land before package pins are usable, but the behavior must be
explicit:

- `nixpkgs_profile` may be accepted and documented once whole-target profile resolution works.
- `nixpkg_pins` should either be absent from public docs or accepted only as `{}` until package-pin
  resolution works.
- A non-empty `nixpkg_pins` map before package-pin resolution is implemented must fail. It must not
  be ignored.
- Graph fields for empty pins may be emitted early if they stabilize the schema, but diagnostics
  should not suggest non-empty pins are supported until they are.

This avoids a misleading intermediate state where users can write package pins that silently build
from the base profile.

## Validation

Focused tests should cover:

- A target with no new attrs uses the default profile.
- A target with `nixpkgs_profile` resolves all `nixpkg_deps` from that profile.
- Graph export includes the explicit profile field.
- The selected target diagnostic reports the profile.
- The same attr from two profiles remains distinct internally.
- A selected target may intentionally resolve different attrs from different profiles when each pin
  has a non-empty rationale.
- Python native extension deps use the same resolver as C++.
- Go CGO deps use the same resolver as C++.
- Dev overrides are rejected or profile-qualified when package pins are active.
- Filtered flake snapshots and remote build source snapshots include the registry input.

Additional contract tests should cover:

- Starlark, TypeScript, and Nix normalize package pin keys identically.
- Inline graph export and cquery graph export produce the same source-selection fields.
- Planner-visible stubs preserve source-selection attrs from public macros.
- Unknown profile names fail with the selected target in the error.
- Package pin entries with unknown profile names fail with the selected target and attr in the error.
- Package pin entries without non-empty rationale strings fail with the selected target and attr in
  the error.
- A raw commit-looking value in `nixpkgs_profile` fails because profiles are names, not commits.
- Raw flake URLs in `nixpkgs_profile` fail because profiles are names, not flake refs.
- Raw commit-looking values and raw flake URLs in `nixpkg_pins[*].nixpkgs_profile` fail because
  profiles are names, not source refs.
- The public graph does not use milestone labels or comments.
- Package pins do not affect toolchain profile selection.
- Remote/filtered builds resolve the same source plan as local selected builds.
- Missing registry files fail in filtered snapshots with targeted diagnostics.
- Overlays attached to the wrong profile do not silently affect pinned packages.
- Remote manifests include source-plan fields.
- Documentation examples in `docs/handbook/starlark-api.md` match implemented defaults and failure
  behavior.
- A pin key that normalizes to an attr absent from `nixpkg_deps` fails or warns according to the
  implemented policy; it must not silently create an undeclared package dependency.
- Planner-visible companions missing source-selection attrs fail a focused regression test.

## Documentation Updates

When implemented, update:

- `build-tools/docs/abstractions.md` for the expanded nixpkgs attr/source contract.
- `build-tools/docs/build-system-design.md` for selected-target planner behavior.
- `build-tools/docs/cpp/curated-providers.md` for examples.
- `build-tools/docs/remote-build-setup.md` for source snapshots, cache evidence, and remote parity.
- `docs/handbook/starlark-api.md` for macro arguments.
- `docs/handbook/provider-sync-cookbook.md` if provider diagnostics or sidecars expose source-plan
  data.
- `docs/viberoots-source-modes.md` and any generated workspace flake docs if consumer workspace
  flake inputs or registry extension points change.
- Any language docs whose native dependency paths consume `nixpkg_deps`.

## External Design Evidence

The package-pin policy is based on how established ecosystems handle version identity, explicit
overrides, and coherent dependency universes:

- Nixpkgs is already built around coherent package sets and scoped overrides. Its Python package
  override docs show the important pattern: after overriding `scipy`, packages in that Python package
  set use the updated `scipy`; if the whole of Nixpkgs should see a modification, use overlays.
  Source: [Nixpkgs Reference Manual](https://nixos.org/manual/nixpkgs/stable/#python).
- vcpkg uses a baseline for the top-level package universe and `overrides` for exact package
  exceptions. Overrides only take effect for packages already in the dependency graph. This is close
  to the proposed `nixpkgs_profile` plus explicit `nixpkg_pins` model.
  Sources: [vcpkg versioning](https://learn.microsoft.com/en-us/vcpkg/users/versioning),
  [vcpkg manifest reference](https://learn.microsoft.com/en-us/vcpkg/reference/vcpkg-json).
- Conan treats binary identity as package metadata. Its package ID model is based on settings,
  options, and requirements, which supports keeping source/profile identity explicit in viberoots
  resolver records instead of deduping by attr alone.
  Source:
  [Conan ABI compatibility](https://docs.conan.io/en/latest/creating_packages/define_abi_compatibility.html).
- Cargo can depend on multiple versions of a crate by giving dependencies distinct local names, but
  its native `links` key permits at most one package per native library link name to avoid duplicate
  native symbols. Viberoots should similarly preserve identity and avoid collapsing same-name attrs
  from different profiles, while leaving package compatibility to the package/build layer.
  Sources:
  [Cargo dependency renaming](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html#renaming-dependencies-in-cargotoml),
  [Cargo `links`](https://doc.rust-lang.org/cargo/reference/build-scripts.html#the-links-manifest-key).
- Go allows incompatible module versions to coexist only when the module path changes, such as a
  `/v2` suffix. Otherwise the build list chooses a single version. This reinforces that coexistence
  needs explicit identity, not just two versions with the same name.
  Source: [Go Modules Reference](https://go.dev/ref/mod#major-version-suffixes).
- Maven resolves multiple versions of the same artifact to one mediated version and lets authors
  force a version from the root project. That is evidence against silent same-name package mixing.
  Source:
  [Maven dependency mechanism](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html#transitive-dependencies).
- npm supports dependency-tree overrides and nested package identity because JavaScript package
  resolution can carry distinct local trees. This is useful precedent for explicit override syntax,
  but it is not a strong precedent for native shared-library mixing.
  Source: [npm overrides](https://docs.npmjs.com/cli/v9/configuring-npm/package-json/#overrides).
- Python's standard virtual environments isolate an interpreter plus packages and binaries for a
  project. That supports whole-target or language-environment selection when interpreters and native
  extensions are involved.
  Source: [Python `venv`](https://docs.python.org/3/library/venv.html).
- Bazel models toolchain selection separately from ordinary dependencies so rule logic can be
  decoupled from platform-based tool choice. That supports the target-level `nixpkgs_profile` as the
  place where the default compiler, stdenv, and package universe come from.
  Source: [Bazel toolchains](https://bazel.build/extending/toolchains).
- ABI compatibility promises are library-specific and conditional. Qt's same-major binary
  compatibility promise depends on the same toolchain, system environment, dynamic builds, and matching
  configuration. MSVC documents binary compatibility for recent toolsets, but calls out exceptions for
  link-time code generation. These are examples of why viberoots should not try to maintain a
  package-specific compatibility database.
  Sources: [Qt releases](https://doc.qt.io/qt-6/qt-releases.html),
  [MSVC binary compatibility](https://learn.microsoft.com/en-us/cpp/porting/binary-compat-2015-2017).

The resulting design rule is:

- Default to one coherent package universe per target.
- Allow narrow package pins only when package identity remains explicit in the graph.
- Require per-pin rationale because each pinned attr is the reviewed exception.
- Resolve a pinned attr consistently from its declared `nixpkgs_profile`.
- Do not encode package-specific compatibility or role knowledge in viberoots.

## Open Questions

No open source-selection questions are currently tracked in this document. New implementation
questions should be added here when they are discovered.
