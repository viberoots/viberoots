# Go linking semantics (cgo + native deps)

This document explains how I wire Go targets that consume native libraries in this repo. It follows the same model as the other linking docs: Buck owns the graph, Nix builds the artifacts, and all behavior changes are opt-in at the call site.

## cgo linking to in-repo C/C++

The basic cgo flow is unchanged. I declare direct in-repo native deps with `repo_cgo_deps`, and I keep `deps` for graph edges.

If I need a Go cgo consumer to follow a C++ library’s `link_deps` transitively, I opt in with `link_closure`. This uses the shared resolver in `build-tools/tools/nix/planner/link-closure.nix`, so the traversal order and determinism match C++ behavior.

### Attributes

- `repo_cgo_deps`: direct in-repo C/C++ library targets the Go target links against.
- `link_closure`: `"direct"` (default) or `"transitive"`; only applies to cgo targets.
- `link_closure_overrides`: per-dep override map for link closure behavior.

### Constraints

I keep these constraints in mind because they are enforced by the planner:

- `link_closure` is only allowed for cgo-enabled Go targets.
- `link_closure_overrides` keys must be present in `repo_cgo_deps`.
- `link_closure` only follows `link_deps` on supported native producers (C++ libs stamped `lang:cpp, kind:lib`).
- `nixpkg_deps` on cgo targets resolve through the selected target source plan. The target
  `nixpkgs_profile` supplies unpinned attrs, and `nixpkg_pins` redirect declared attrs to their pin
  profiles with rationale preserved for planner inspection.

### Example

```python
# apps/demo-cli/TARGETS
load("@viberoots//build-tools/go:defs.bzl", "nix_go_binary")

nix_go_binary(
    name = "demo",
    srcs = ["cmd/demo/main.go"],
    repo_cgo_deps = ["//projects/libs/core:core"],
    link_closure = "transitive",
    link_closure_overrides = {
        "//projects/libs/core:core": "transitive",
    },
)
```

This keeps the default behavior unchanged when `link_closure` is not set, while still allowing explicit opt-in for transitive native linkage.
