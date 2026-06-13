### build-tools/tools/nix/mapping.nix — Dispatch Table Design

This document defines the purpose, shape, and usage of `build-tools/tools/nix/mapping.nix`, an optional and minimal dispatch table that the Nix planner (`build-tools/tools/nix/graph-generator.nix`) consults to route custom Buck rule types to language templates.

### Goals

- Keep the planner tiny and generic while allowing repositories to introduce custom Buck rule types (e.g., `go_service`, `my_go_lib`).
- Enable one-line, declarative routing of a Buck `rule_type` to a language template and "kind" without modifying planner logic.
- Preserve deterministic behavior and idempotency; do not introduce side effects or dynamic I/O.

### How the Planner Uses It

The planner imports `build-tools/tools/nix/mapping.nix` when present and reads `dispatch`:

```nix
# build-tools/tools/nix/graph-generator.nix (excerpt; already implemented)
T = import ./lang-templates.nix { inherit pkgs; };
M = if builtins.pathExists ./mapping.nix then import ./mapping.nix else {};
D = M.dispatch or {};

pick = n:
  let
    rt = get n "rule_type";
    lbs = get n "labels";
    hasDispatch = (rt != null) && builtins.hasAttr rt D;
    hasGoPrefix = (rt != null) && lib.hasPrefix "go_" rt;
  in
    if hasDispatch then D.${rt}
    else if hasGoPrefix then { template = "go"; kind = if lib.hasSuffix "_binary" rt then "bin" else "lib"; }
    else if lbs != null && builtins.elem "lang:go" lbs then { template = "go"; kind = if builtins.elem "kind:bin" lbs then "bin" else "lib"; }
    else null;
```

If a node’s `rule_type` matches a key in `dispatch`, the corresponding entry (an attrset) is returned to the planner with at least `template` and `kind` fields.

### File Location

- Path: `build-tools/tools/nix/mapping.nix`
- Not committed? It should be committed to version control alongside planner templates to ensure reproducibility.

### Minimal Schema (v1)

```nix
# build-tools/tools/nix/mapping.nix
{
  # Map Buck rule_type (string) -> { template = "<lang>"; kind = "bin"|"lib"; }
  dispatch = {
    # Examples — add only what your repo defines:
    # go_service = { template = "go"; kind = "bin"; };
    # my_go_lib  = { template = "go"; kind = "lib"; };
  };
}
```

- **template**: Name of the language template exposed by `build-tools/tools/nix/lang-templates.nix` (currently `"go"`).
- **kind**: Either `"bin"` or `"lib"` (selects `goApp` vs `goLib`).

This matches how `graph-generator.nix` consumes the mapping today. No other keys are read by the planner in v1.

### Recommended Conventions

- Keep `dispatch` small and example-driven. Only add entries for custom rule types that do not already start with the canonical prefix (e.g., non-`go_*`).
- Prefer establishing `labels = ["lang:go", "kind:bin"]` in your macros; the mapping is primarily for repos that want custom rule type names without depending on labels.
- Ensure `rule_type` strings in Buck match what you put in `dispatch` exactly.

### Examples

1. Custom service rule wrapping `go_binary`:

```nix
{
  dispatch = {
    go_service = { template = "go"; kind = "bin"; };
  };
}
```

2. Custom internal library rule wrapping `go_library`:

```nix
{
  dispatch = {
    my_go_lib = { template = "go"; kind = "lib"; };
  };
}
```

### Non‑Goals (v1)

- Attribute renaming, transformation, or codegen hints. If needed later, we can add an optional `attrs` sub-attrset per rule type, but the current planner does not read it. Keeping v1 minimal avoids diverging responsibilities.

### Testing Strategy

- Add or adapt a small test that simulates a node with `rule_type = "go_service"` and verifies the planner emits a Go build using the chosen kind.
- Negative test: a custom rule type absent from `dispatch` and without `lang:go` labels should be ignored by `pick`.

### Operational Guidance

- If your repo adds a new Buck macro that wraps Go rules under a custom name, add one line to `dispatch` so the planner recognizes it.
- If you deprecate a custom rule type, remove its entry from `dispatch` in the same change and migrate any targets.

### Future Extensions (v2+)

- `attrs` or `hints`: allow an entry to suggest template-specific knobs (e.g., alternate `modulesToml` path). This requires explicit planner support and should remain opt‑in and documented.
- Multi-language: add other `template` values (e.g., `"rust"`, `"node"`) when those language templates exist.

### Migration Plan

1. Create `build-tools/tools/nix/mapping.nix` with an empty `dispatch = {}`.
2. For each custom rule type you already use, add a single line mapping to `template = "go"` and `kind`.
3. Run glue stages locally:
   - `node build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`
   - `node build-tools/tools/buck/sync-providers.ts`
   - `node build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`
4. Build a representative target and confirm no behavior change.

### Rollback

- Removing `build-tools/tools/nix/mapping.nix` reverts behavior to the existing label- and prefix-based detection in the planner.
