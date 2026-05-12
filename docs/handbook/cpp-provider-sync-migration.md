## C++ Provider Sync No-op

This repo no longer generates or consumes C++ provider rules. C++ targets declare `nixpkg_deps` at call sites, macros stamp `nixpkg:` labels, and the planner consumes those labels directly.

- What changed:
  - C++ provider sync is a no-op; `build-tools/tools/buck/sync-providers.ts --lang=cpp` does nothing.
  - The install glue skips the C++ sync step.
  - New inspector: `build-tools/tools/buck/inspect-cpp-attrs.ts` prints effective `nixpkg:` attrs per target.
- What did not change:
  - Node importer-scoped providers remain.
  - Go provider sync remains for patch-driven invalidation.
- How to inspect:
  - `node build-tools/tools/buck/inspect-cpp-attrs.ts --json`
  - `node build-tools/tools/buck/inspect-cpp-attrs.ts --target //<pkg>:<name>`

Rationale and full context: see `docs/cpp/drop-cpp-provider.md` (target state).
